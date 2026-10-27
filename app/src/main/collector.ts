/**
 * collector.exe 실행·수신 (호출위치표 B) — TA 민서 2026-10-06
 * 수집기를 자식 프로세스로 띄우고 stdout 1줄(=1분 창 JSON)을 받아 onWindow 로 넘긴다.
 *  - 08:30~18:30(= 방해금지 밖)에만 켠다. 설정의 quietEnabled/quietHours 를 1분마다 보고 켜고 끈다.
 *  - 패키징: electron-builder extraResources 로 resources/collector → process.resourcesPath/collector/collector.exe
 *  - 개발(npm run dev): <app>/resources/collector/collector.exe
 *  - 원시 CSV는 --raw-dir 로 userData/carepong_raw 에 저장(설치 폴더 오염 방지)
 *  - 수집기 첫 줄 {"event":"started"} 등 features 없는 줄은 무시. 콘솔창 안 뜸(windowsHide).
 *  - (10/27) collector.exe 는 PyInstaller onefile 빌드라 런처(부트로더) + 워커(Python 런타임) 2개 프로세스로 실행된다.
 *    child.kill() 은 런처만 종료해 워커(전역 키보드·마우스 훅 보유)가 매일 1개씩 잔존 프로세스(orphan)로 누적됐다.
 *    → 프로세스 트리 종료(taskkill /T) + 시작 시 동일 exe 경로의 잔존 프로세스 정리. (입력 지연 제보 10/27)
 */
import { app } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { uploadRawBatch } from './api'

export interface CollectorLine {
  window_start: string
  window_sec: number
  features: Record<string, number> // 16피처
}

let child: ChildProcess | null = null
let uploaderBusy = false
let lastAttempt = new Map<string, { next: number; backoff: number }>()
let collectorCpNumber: string | null = null
/** 로컬 세션 라벨 전용. 인증은 Electron Bearer 토큰으로 수행. */
export function setCollectorCpNumber(value: string | null): void {
  collectorCpNumber = value && /^CP-[A-Za-z0-9_-]+$/.test(value) ? value : null
}
let paused = false // 사용자가 방해금지 수동 토글 / 수집 일시중지 했을 때

function exePath(): string {
  // 패키징: extraResources from "resources/collector" to "collector" → process.resourcesPath/collector/collector.exe
  // 개발(npm run dev): <app>/resources/collector/collector.exe
  return app.isPackaged
    ? path.join(process.resourcesPath, 'collector', 'collector.exe')
    : path.join(app.getAppPath(), 'resources', 'collector', 'collector.exe')
}

/** 프로세스 트리 종료 — Windows 는 taskkill /T (런처·워커 모두), 그 외 플랫폼은 SIGTERM. */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 })
    if (r.status === 0) return
    console.warn('[collector] taskkill 실패 status=', r.status, String(r.stderr ?? '').trim())
  }
  try {
    process.kill(pid)
  } catch {
    /* 이미 종료됨 */
  }
}

/**
 * 동일 exe 경로의 collector.exe 중 현재 인스턴스가 관리하지 않는 잔존 프로세스(orphan) PID 목록. Windows 전용.
 * 다른 프로그램의 collector.exe 를 오인 종료하지 않도록 ExecutablePath 를 우리 exe 와 대조한다.
 */
export function listOrphanCollectorPids(exe: string, ownPid: number | null, out?: string): number[] {
  if (process.platform !== 'win32') return []
  let text = out
  if (text === undefined) {
    const cmd = "Get-CimInstance Win32_Process -Filter \"Name='collector.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.ExecutablePath)\" }"
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 8000, encoding: 'utf8' })
    if (r.status !== 0 || typeof r.stdout !== 'string') {
      console.warn('[collector] 잔존 프로세스 조회 실패 status=', r.status)
      return []
    }
    text = r.stdout
  }
  const want = exe.replace(/\//g, '\\').toLowerCase()
  const rows = text.split(/\r?\n/).map(l => l.split('\t')).filter(p => p.length === 3 && /^\d+$/.test(p[0]))
  const byPid = new Map(rows.map(p => [Number(p[0]), { ppid: Number(p[1]), path: p[2].trim().toLowerCase() }]))
  const own = new Set<number>()
  if (ownPid != null) {
    own.add(ownPid)
    for (const [pid, { ppid }] of byPid) if (ppid === ownPid) own.add(pid) // 현재 런처(ownPid)가 실행한 워커
  }
  return [...byPid].filter(([pid, { path: p }]) => p === want && !own.has(pid)).map(([pid]) => pid)
}

/** 앱 시작·수집기 시작 전에 이전 실행이 남긴 잔존 collector.exe 프로세스를 정리한다. */
export function cleanupOrphanCollectors(): number {
  let pids: number[] = []
  try {
    pids = listOrphanCollectorPids(exePath(), child?.pid ?? null)
  } catch (e) {
    console.warn('[collector] 잔존 프로세스 조회 예외:', e)
    return 0
  }
  for (const pid of pids) killTree(pid)
  if (pids.length) console.warn('[collector] 잔존 수집기 프로세스 정리:', pids.join(','))
  return pids.length
}

export function startCollector(onWindow: (w: CollectorLine) => void, windowSec = 60): boolean {
  if (child) return true
  const exe = exePath()
  if (!fs.existsSync(exe)) {
    console.warn('[collector] exe 없음 — 감지 경로 비활성:', exe)
    return false
  }
  cleanupOrphanCollectors() // 이전 실행·이전 버전이 남긴 잔존 프로세스(전역 훅 보유)를 먼저 정리
  // 원시 CSV 저장 위치를 userData로 고정(--raw-dir) — 없으면 수집기가 exe 폴더(설치 폴더)에 쌓는 부작용
  const rawDir = path.join(app.getPath('userData'), 'carepong_raw')
  try {
    fs.mkdirSync(rawDir, { recursive: true })
  } catch {
    /* 디렉토리 생성 실패해도 수집기 쪽에서 처리 */
  }
  const args = ['--raw-dir', rawDir, '--spool-only']
  if (collectorCpNumber) args.push('--user-id', collectorCpNumber)
  if (windowSec !== 60) args.push('--window', String(windowSec))
  child = spawn(exe, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const rl = readline.createInterface({ input: child.stdout! })
  rl.on('line', (line) => {
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      return
    }
    if (j && j.features) onWindow(j as CollectorLine)
  })
  child.stderr?.on('data', (d) => console.warn('[collector]', String(d).trim()))
  child.on('exit', (code) => {
    console.warn('[collector] 종료 code=', code)
    child = null
  })
  console.log('[collector] 시작', exe)
  return true
}

export function stopCollector(): void {
  if (child) {
    const pid = child.pid
    if (pid != null) killTree(pid) // 런처만 종료하던 child.kill() 대신 프로세스 트리 종료
    else child.kill()
    child = null
    console.log('[collector] 정지 pid=', pid)
  }
}

export const collectorRunning = (): boolean => child !== null

export function setCollectorPaused(on: boolean): void {
  paused = on
}

/** Raw uploader lives in Electron: continues while collection is stopped. */
const rawDirPath = (): string => path.join(app.getPath('userData'), 'carepong_raw')
const spoolDirPath = (): string => path.join(rawDirPath(), 'spool')
const KST_OFFSET = 9 * 60 * 60 * 1000
// Calendar-day retention avoids deleting Thursday data before the next Tuesday startup.
const UNSENT_RETENTION_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const kstDate = (ms: number): string => new Date(ms + KST_OFFSET).toISOString().slice(0, 10)
const kstDay = (ms: number): number => new Date(ms + KST_OFFSET).getUTCDay()
const kstMinute = (ms: number): number => {
  const d = new Date(ms + KST_OFFSET)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
const eventMillis = (ts: unknown): number => {
  if (typeof ts === 'number') return ts * 1000
  if (typeof ts === 'string') return Date.parse(ts)
  return NaN
}
function appendDeletionLog(info: Record<string, unknown>): boolean {
  try {
    fs.appendFileSync(path.join(rawDirPath(), 'raw_deletion_audit.jsonl'), JSON.stringify(info) + '\n', 'utf8')
    return true
  } catch (e) {
    console.warn('[raw-upload] 삭제 감사로그 기록 실패:', e)
    return false
  }
}
function recoverClosedSpool(): void {
  if (collectorRunning()) return // never seal a file owned by a running collector
  const dir = spoolDirPath()
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.ndjson.open'))) {
    const original = path.join(dir, name)
    const output = original.slice(0, -'.open'.length) + '.gz'
    try {
      const raw = fs.readFileSync(original)
      if (raw.length === 0) { fs.unlinkSync(original); continue }
      const temp = output + '.part'
      fs.writeFileSync(temp, zlib.gzipSync(raw))
      fs.renameSync(temp, output)
      fs.unlinkSync(original)
    } catch (e) { console.warn('[raw-upload] 미완료 파일 복구 실패:', name, e) }
  }
}
async function flushRawQueue(): Promise<void> {
  if (uploaderBusy) return
  uploaderBusy = true
  try {
    recoverClosedSpool()
    const dir = spoolDirPath()
    if (!fs.existsSync(dir)) return
    const names = fs.readdirSync(dir).filter(n => n.endsWith('.ndjson.gz')).sort()
    for (const name of names) {
      const file = path.join(dir, name)
      if (!fs.existsSync(file)) continue
      const now = Date.now()
      const retry = lastAttempt.get(name)
      if (retry && now < retry.next) continue
      let compressed: Buffer, records: any[], firstMs: number, date: string
      try {
        compressed = fs.readFileSync(file)
        records = zlib.gunzipSync(compressed).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
        if (!records.length) throw new Error('empty batch')
        const times = records.map(r => eventMillis(r.ts))
        if (times.some(t => !Number.isFinite(t))) throw new Error('invalid timestamp')
        firstMs = times.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY)
        date = kstDate(firstMs)
        if (times.some(t => kstDate(t) !== date)) throw new Error('batch crosses KST date')
      } catch (e) {
        console.warn('[raw-upload] 데이터 검사 실패; 삭제하지 않음:', name, e)
        continue
      }
      const batchId = name.slice(0, -'.ndjson.gz'.length)
      const reason = compressed.length > 200 * 1024 * 1024 ? 'FILE_OVER_200MB' :
        now - firstMs >= UNSENT_RETENTION_DAYS * DAY_MS ? 'UNSENT_OVER_7_DAYS' : null
      if (reason) {
        if (appendDeletionLog({ event: 'raw_file_deleted', reason, batch_id: batchId,
          size_bytes: compressed.length, data_date: date, deleted_at: new Date().toISOString(),
          upload_status: 'pending', s3_confirmed: false })) {
          fs.unlinkSync(file)
          lastAttempt.delete(name)
        }
        continue
      }
      // Upload worker is independent of collection hours and backend uptime.
      // Friday sealed batches: 17:30 first segment, 18:30 remaining segment.
      // Other days: midnight following event date + 36 hours.
      const eligible = kstDay(firstMs) === 5
        ? (now >= Date.parse(date + (kstMinute(firstMs) < 17 * 60 + 30 ? 'T17:30:00+09:00' : 'T18:30:00+09:00')))
        : (now >= Date.parse(date + 'T00:00:00+09:00') + DAY_MS + 36 * 60 * 60 * 1000)
      if (!eligible) continue
      const parts = batchId.split('__')
      if (parts.length !== 3 || !['ev', 'wd'].includes(parts[1])) {
        console.warn('[raw-upload] 배치 이름 형식 오류; 삭제하지 않음:', name)
        continue
      }
      // ML Raw 계약: 이벤트 행은 (ts, session, kind, value), 다이내믹스는 km-raw-v1.
      const session = parts[0]
      const eventKinds = new Set(['k_char', 'k_special', 'k_dir', 'k_err', 'k_space', 'k_shortcut', 'm_left', 'm_right', 'm_scroll', 'm_move'])
      const valid = parts[1] === 'ev'
        ? records.every(r => r && typeof r.ts === 'number' && r.session === session &&
            eventKinds.has(r.kind) && (r.value == null || (typeof r.value === 'number' && Number.isFinite(r.value))) &&
            (r.kind !== 'm_move' || (typeof r.value === 'number' && r.value >= 0)))
        : records.every(r => r && r.schema === 'km-raw-v1' &&
            typeof r.window_start === 'number' && typeof r.window_sec === 'number' &&
            r.keyboard && typeof r.keyboard === 'object' && r.mouse && typeof r.mouse === 'object')
      if (!valid) {
        console.warn('[raw-upload] ML Raw 스키마 불일치; 파일 유지:', name)
        continue
      }
      const meta = {
        batch_id: batchId, stream: parts[1],
        schema: parts[1] === 'wd' ? 'km-raw-v1' : 'km-ev-v1',
        session: parts[0], event_date_kst: date, count: records.length,
        bytes: compressed.length, sha256: crypto.createHash('sha256').update(compressed).digest('hex'),
        content_encoding: 'gzip', ts_first: records[0].ts, ts_last: records[records.length - 1].ts,
        collector_version: '0.2.3',
      }
      const ok = await uploadRawBatch(meta, compressed)
      if (ok) {
        fs.unlinkSync(file)
        lastAttempt.delete(name)
        console.log('[raw-upload] S3 ACK 후 로컬 삭제:', batchId)
      } else {
        const backoff = Math.min((retry?.backoff || 15) * 2, 600)
        lastAttempt.set(name, { next: Date.now() + backoff * 1000, backoff })
      }
    }
  } catch (e) { console.warn('[raw-upload] Queue 처리 실패:', e) }
  finally { uploaderBusy = false }
}

/** "HH:MM" 두 시각 사이인지 (자정을 넘는 구간 18:30~08:30 도 처리) */
export function inQuietHours(now: Date, start = '18:30', end = '08:30'): boolean {
  const toMin = (s: string): number => {
    const [h, m] = s.split(':').map(Number)
    return h * 60 + (m || 0)
  }
  const cur = now.getHours() * 60 + now.getMinutes()
  const a = toMin(start)
  const b = toMin(end)
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b
}

// 수집 창은 업무시간(08:30~18:30)으로 고정 — 기획서(14.데이터 수집·3.스트레스 감지): "감지·수집 창 = 08:30~18:30 고정(방해금지 토글과 분리)".
// 이 시간 밖(야간 등)이면 quietEnabled 설정과 무관하게 무조건 수집 차단 → 21:27 같은 야간 창 원천 차단.
const WORK_START_MIN = 8 * 60 + 30 // 08:30
const WORK_END_MIN = 18 * 60 + 30 // 18:30
export function inWorkWindow(now: Date): boolean {
  const cur = now.getHours() * 60 + now.getMinutes()
  return cur >= WORK_START_MIN && cur < WORK_END_MIN
}

/**
 * 1분마다 수집기를 켜고 끈다.
 * 수집은 업무시간(08:30~18:30)에만 — 방해금지 설정(quietEnabled/quietHours)과 무관하게 고정(기획서 A안).
 * paused(수동 일시중지)면 업무시간이어도 끈다.
 */
export function scheduleCollector(
  _getConfig: () => { quietEnabled?: boolean; quietHours?: { start: string; end: string } },
  onWindow: (w: CollectorLine) => void,
): void {
  const tick = (): void => {
    const shouldRun = inWorkWindow(new Date()) && !paused // 업무시간 밖이면 무조건 차단(기획서 고정 창)
    if (shouldRun && !collectorRunning()) startCollector(onWindow)
    if (!shouldRun && collectorRunning()) stopCollector()
  }
  cleanupOrphanCollectors() // 야간(방해금지)에 앱을 켜도 이전 잔존 프로세스는 즉시 정리
  tick()
  void flushRawQueue()
  setInterval(tick, 60 * 1000)
  setInterval(() => void flushRawQueue(), 30 * 1000)
  app.on('before-quit', stopCollector)
}
