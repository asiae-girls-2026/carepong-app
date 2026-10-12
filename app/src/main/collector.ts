/**
 * collector.exe 실행·수신 (호출위치표 B) — TA 민서 2026-10-06
 * 수집기를 자식 프로세스로 띄우고 stdout 1줄(=1분 창 JSON)을 받아 onWindow 로 넘긴다.
 *  - 08:30~18:30(= 방해금지 밖)에만 켠다. 설정의 quietEnabled/quietHours 를 1분마다 보고 켜고 끈다.
 *  - 패키징: electron-builder extraResources 로 resources/collector → process.resourcesPath/collector/collector.exe
 *  - 개발(npm run dev): <app>/resources/collector/collector.exe
 *  - 원시 CSV는 --raw-dir 로 userData/carepong_raw 에 저장(설치 폴더 오염 방지)
 *  - 수집기 첫 줄 {"event":"started"} 등 features 없는 줄은 무시. 콘솔창 안 뜸(windowsHide).
 */
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

export interface CollectorLine {
  window_start: string
  window_sec: number
  features: Record<string, number> // 16피처
}

let child: ChildProcess | null = null
let paused = false // 사용자가 방해금지 수동 토글 / 수집 일시중지 했을 때

function exePath(): string {
  // 패키징: extraResources from "resources/collector" to "collector" → process.resourcesPath/collector/collector.exe
  // 개발(npm run dev): <app>/resources/collector/collector.exe
  return app.isPackaged
    ? path.join(process.resourcesPath, 'collector', 'collector.exe')
    : path.join(app.getAppPath(), 'resources', 'collector', 'collector.exe')
}

export function startCollector(onWindow: (w: CollectorLine) => void, windowSec = 60): boolean {
  if (child) return true
  const exe = exePath()
  if (!fs.existsSync(exe)) {
    console.warn('[collector] exe 없음 — 감지 경로 비활성:', exe)
    return false
  }
  // 원시 CSV 저장 위치를 userData로 고정(--raw-dir) — 없으면 수집기가 exe 폴더(설치 폴더)에 쌓는 부작용
  const rawDir = path.join(app.getPath('userData'), 'carepong_raw')
  try {
    fs.mkdirSync(rawDir, { recursive: true })
  } catch {
    /* 디렉토리 생성 실패해도 수집기 쪽에서 처리 */
  }
  const args = ['--raw-dir', rawDir]
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
    child.kill()
    child = null
    console.log('[collector] 정지')
  }
}

export const collectorRunning = (): boolean => child !== null

export function setCollectorPaused(on: boolean): void {
  paused = on
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

/**
 * 1분마다 설정을 보고 수집기를 켜고 끈다.
 * getConfig: 현재 설정 (quietEnabled, quietHours{start,end}) 을 돌려주는 함수
 */
export function scheduleCollector(
  getConfig: () => { quietEnabled?: boolean; quietHours?: { start: string; end: string } },
  onWindow: (w: CollectorLine) => void,
): void {
  const tick = (): void => {
    const c = getConfig()
    const quiet =
      (c.quietEnabled ?? true) && inQuietHours(new Date(), c.quietHours?.start ?? '18:30', c.quietHours?.end ?? '08:30')
    const shouldRun = !quiet && !paused
    if (shouldRun && !collectorRunning()) startCollector(onWindow)
    if (!shouldRun && collectorRunning()) stopCollector()
  }
  tick()
  setInterval(tick, 60 * 1000)
  app.on('before-quit', stopCollector)
}
