/**
 * 케어퐁 앱 → 서버 호출 모듈 (Electron main 프로세스용, Node 18+ fetch 사용)
 * 원작: TA 민서 · 2026-10-02 · 명세 v5.1 (claude.ai/artifact/Uu7dGsAXBqH2R6Bem2Se9P)
 * 이식: 연우 · 2026-10-05 — 민서님 api.js 를 이 프로젝트(ESM+TS)에 맞춰 포팅. 로직·엔드포인트·필드 동일.
 *
 * 실시간 2개(postWindow·postSelfReport)만 즉시 전송. 나머지는 logEvent 로 로컬에 쌓였다가
 * 매일 08:30 또는 앱 시작 시 자동으로 묶어 전송(flushEvents). 서버가 받았다고 한 것만 지움.
 * 서버 주소는 환경변수 CAREPONG_API (기본 http://localhost:8000). AWS 올라가면 이 값만 교체.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const BASE = process.env.CAREPONG_API ?? 'http://localhost:8000'
const V = `${BASE}/v1`
const FLUSH_AT = '08:30' // 결정 C: 방해금지 해제 시각 = 이벤트 묶음 전송 시각
const FLUSH_MAX = 5000 // /events/batch 한 번 최대 건수

let token: string | null = null
let userId: string | null = null
let appVersion = '0.0.0'
let queueFile: string | null = null

const uid = (): string => crypto.randomUUID()
const nowISO = (): string => new Date().toISOString() // 서버가 KST 로 해석. 앱 시계 그대로

export interface WindowResult {
  stress_score: number // 1차 용어 통일: 서버 WindowOut 의 점수 필드 (구 condition_score)
  level: number
  prompt: boolean
  prompt_type: 'morning' | 'spike' | 'random' | null
  window_id: string
}
export type SelfReportStatus = 'answered' | 'dismissed' | 'ignored' | 'pending'

async function call(
  method: string,
  url: string,
  body?: unknown,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {},
): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(userId ? { 'X-User-Id': userId } : {}), // X-User-Id 는 D07 인증 전 임시
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`)
    return res.status === 204 ? null : await res.json()
  } finally {
    clearTimeout(t)
  }
}

/** 앱 시작 시 1회. CP 번호는 앱이 로컬 발급 (M07). dataDir = 이벤트 큐 파일 둘 폴더 */
export async function init({
  cpNumber,
  deviceId,
  appVersion: ver,
  dataDir,
}: {
  cpNumber: string
  deviceId: string
  appVersion: string
  dataDir: string
}): Promise<void> {
  appVersion = ver
  queueFile = path.join(dataDir, 'carepong-events.jsonl')
  try {
    const r = await call('POST', `${V}/enroll`, {
      cp_number: cpNumber,
      device_id: deviceId,
      app_version: ver,
      os: process.platform === 'win32' ? 'windows' : process.platform,
    })
    token = r.access_token
    userId = r.user_id
  } catch (e) {
    userId = cpNumber
    console.warn('[api] enroll 실패, 오프라인 모드:', (e as Error).message)
  }
  await flushEvents() // 꺼져 있던 동안 못 보낸 것
  scheduleDailyFlush()
}

/** 1분 창 집계 끝날 때마다. features = 수집기(collector.exe) stdout 의 features 그대로 (16개, 활동 0 창도 보냄)
 *  반환 {stress_score, level, prompt, prompt_type, window_id} — prompt 가 true 면 P03 팝업 */
export async function postWindow({
  windowId = uid(),
  sessionId,
  windowStart,
  features,
  dnd = false,
}: {
  windowId?: string
  sessionId: string
  windowStart: string
  features: Record<string, number>
  dnd?: boolean
}): Promise<WindowResult> {
  return call(
    'POST',
    `${V}/windows`,
    {
      window_id: windowId,
      session_id: sessionId,
      window_start: windowStart,
      window_sec: 60,
      features,
      dnd,
      client_event_id: uid(),
    },
    { timeoutMs: 4000 },
  )
}

/** 팝업 응답·체크인. trigger = postWindow 응답의 prompt_type ("morning"|"spike"|"random") 또는 "checkin"
 *  yesno: 1 예 / 0 아니요 / null 무응답. level1to5: [예] 후 1~5, 안 물었으면 null
 *  status: "answered"(O/X 누름) | "dismissed"(닫기) | "ignored"(다른 곳 클릭) | "pending"(응답 없이 다음 팝업 시각 됨)
 *  팝업은 자동으로 안 닫힘 — 네 가지 중 하나로 반드시 한 번 보낸다 (혜윤 3_동작규칙 5) */
export async function postSelfReport({
  windowId = null,
  trigger,
  yesno = null,
  level1to5 = null,
  status = 'answered',
  promptTime = null,
  clickedAt = null,
  questionVersion = 'q1',
}: {
  windowId?: string | null
  trigger: string
  yesno?: 1 | 0 | null
  level1to5?: number | null
  status?: SelfReportStatus
  promptTime?: string | null
  clickedAt?: string | null
  questionVersion?: string
}): Promise<any> {
  const latency =
    promptTime && clickedAt
      ? Math.round((new Date(clickedAt).getTime() - new Date(promptTime).getTime()) / 1000)
      : null
  return call('POST', `${V}/self-reports`, {
    window_id: windowId,
    trigger,
    yesno,
    level_1to5: level1to5,
    status,
    prompt_time: promptTime,
    clicked_at: clickedAt,
    latency_sec: latency,
    question_version: questionVersion,
    answered_at: nowISO(),
    client_event_id: uid(),
  })
}

/** 이벤트 1건을 로컬 큐에 추가 (즉시 전송 X). event·props 는 채원 마커 표 그대로. */
export function logEvent(event: string, screen: string | null, props: Record<string, unknown> = {}): void {
  if (!queueFile) return // init 전이면 조용히 무시 (앱 동작 영향 없음)
  const line = JSON.stringify({
    client_event_id: uid(),
    event,
    screen,
    occurred_at: nowISO(),
    props,
    app_version: appVersion,
  })
  fs.appendFileSync(queueFile, line + '\n')
}

/** 큐를 묶어서 전송. accepted_ids 만 지우고 나머지는 남겨 다음에 다시. 수동 호출도 가능(종료 직전 등) */
export async function flushEvents(): Promise<{ sent: number }> {
  if (!queueFile || !fs.existsSync(queueFile)) return { sent: 0 }
  const lines = fs.readFileSync(queueFile, 'utf8').split('\n').filter(Boolean)
  if (!lines.length) return { sent: 0 }
  const events = lines.slice(0, FLUSH_MAX).map((l) => JSON.parse(l))
  let r
  try {
    r = await call('POST', `${V}/events/batch`, { events }, { timeoutMs: 20000 })
  } catch (e) {
    console.warn('[api] events/batch 실패, 다음에 재시도:', (e as Error).message)
    return { sent: 0 }
  }
  const done = new Set<string>([...r.accepted_ids, ...r.rejected_ids]) // 거절(이름 오류)도 큐에서 뺌
  if (r.rejected_ids.length) console.warn('[api] 거절된 이벤트:', r.rejected_ids.length)
  const rest = lines.filter((l) => !done.has(JSON.parse(l).client_event_id))
  fs.writeFileSync(queueFile, rest.length ? rest.join('\n') + '\n' : '')
  logEvent('beta_upload', null, { ok: true, bytes: lines.join('\n').length, sent: r.accepted_ids.length })
  if (rest.length >= FLUSH_MAX) return flushEvents() // 많이 쌓였으면 이어서
  return { sent: r.accepted_ids.length }
}

function scheduleDailyFlush(): void {
  const [h, m] = FLUSH_AT.split(':').map(Number)
  const next = new Date()
  next.setHours(h, m, 0, 0)
  if (next <= new Date()) next.setDate(next.getDate() + 1)
  setTimeout(
    async () => {
      await flushEvents()
      scheduleDailyFlush()
    },
    next.getTime() - Date.now(),
  )
}

/** 설정·펫 백업 (바뀔 때). 원본은 앱 로컬 — 실패해도 앱 동작엔 영향 없음 */
export const putRoutines = (settings: Record<string, unknown>): Promise<any> =>
  call('PUT', `${V}/routines`, settings).catch((e) => {
    console.warn('[api] putRoutines 실패(무시):', (e as Error).message)
    return null
  })
export const putPet = (pet: Record<string, unknown>): Promise<any> =>
  call('PUT', `${V}/pet`, pet).catch((e) => {
    console.warn('[api] putPet 실패(무시):', (e as Error).message)
    return null
  })
export const getConfig = (): Promise<any> => call('GET', `${V}/config`)
