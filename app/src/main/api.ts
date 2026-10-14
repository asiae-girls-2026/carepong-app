/**
 * 케어퐁 앱 → 서버 호출 모듈 (Electron main 프로세스용, Node 18+ fetch 사용)
 * 원작: TA 민서 · 2026-10-02 · 명세 v5.1 (claude.ai/artifact/Uu7dGsAXBqH2R6Bem2Se9P)
 * 이식: 연우 · 2026-10-05 — 민서님 api.js 를 이 프로젝트(ESM+TS)에 맞춰 포팅. 로직·엔드포인트·필드 동일.
 *
 * 실시간 2개(postWindow·postSelfReport)만 즉시 전송. 나머지는 logEvent 로 로컬에 쌓였다가
 * 매일 08:30 또는 앱 시작 시 자동으로 묶어 전송(flushEvents). 서버가 받았다고 한 것만 지움.
 * 서버 주소는 apiConfig.ts 의 API_BASE (기본 = ALB 운영 주소). 로컬 테스트만 CAREPONG_API=http://localhost:8000.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { safeStorage } from 'electron'
import { API_BASE } from './apiConfig'

const BASE = API_BASE
const V = `${BASE}/v1`
const FLUSH_AT = '08:30' // 결정 C: 방해금지 해제 시각 = 이벤트 묶음 전송 시각
const FLUSH_MAX = 5000 // /events/batch 한 번 최대 건수
const FLUSH_RETRY_MS = 10 * 60 * 1000 // 전송 실패·부분전송 시 재시도 간격(10분, 큐 빌 때까지 반복)
let retryTimer: ReturnType<typeof setTimeout> | null = null

let legacyCp: string | null = null
let token: string | null = null
let initializing: Promise<void> | null = null
let flushing: Promise<{ sent: number }> | null = null
class ApiError extends Error { constructor(public status: number) { super(`API HTTP ${status}`) } }
let userId: string | null = null
let appVersion = '0.0.0'
let queueFile: string | null = null

const uid = (): string => crypto.randomUUID()
const nowISO = (): string => new Date().toISOString() // 서버가 KST 로 해석. 앱 시계 그대로

export interface WindowResult {
  condition_score: number | null // 서버 WindowOut 필드명 그대로. 활동 0 창·모델 실패 시 null (10/7 용어: condition_score 로 통일)
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
        ...(legacyCp ? { 'X-User-Id': legacyCp } : {}), // windows/self-reports는 서버 인증 전환까지 회원번호 사용
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new ApiError(res.status)
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
  fs.mkdirSync(dataDir, { recursive: true })
  legacyCp = cpNumber
  const authFile = path.join(dataDir, 'carepong-auth.json')
  const authenticate = async (): Promise<void> => {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('OS secure token storage unavailable')
    }
    if (fs.existsSync(authFile)) {
      const saved = JSON.parse(fs.readFileSync(authFile, 'utf8'))
      if (saved.cp_number !== cpNumber || saved.base !== BASE) throw new Error('Saved identity/server mismatch; recovery required')
      token = safeStorage.decryptString(Buffer.from(saved.encrypted_token, 'base64'))
      userId = saved.user_id
      // 401이어도 저장 토큰/회원번호를 지우거나 신규 회원으로 바꾸지 않는다.
      await call('GET', `${V}/enroll`)
      return
    }
    const r = await call('POST', `${V}/enroll`, {
      cp_number: cpNumber, device_id: deviceId, app_version: ver,
      os: process.platform === 'win32' ? 'windows' : process.platform,
    })
    if (typeof r.access_token !== 'string' || typeof r.user_id !== 'string') throw new Error('Invalid enrollment response')
    const encrypted = safeStorage.encryptString(r.access_token).toString('base64')
    const tmp = `${authFile}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ cp_number: cpNumber, base: BASE, user_id: r.user_id, encrypted_token: encrypted }), { mode: 0o600 })
    fs.renameSync(tmp, authFile)
    token = r.access_token
    userId = r.user_id
  }
  initializing = authenticate().catch((e) => {
    console.warn('[api] 인증 실패; 회원번호와 이벤트 큐 유지:', (e as Error).message)
    if (e instanceof ApiError && (e.status === 401 || e.status === 409)) token = null
  })
  await initializing
  initializing = null
  await flushEvents()
  scheduleDailyFlush()
}

/** 1분 창 집계 끝날 때마다. features = 수집기(collector.exe) stdout 의 features 그대로 (16개, 활동 0 창도 보냄)
 *  반환 {condition_score, level, prompt, prompt_type, window_id} — prompt 가 true 면 P03 팝업 */
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
  const r = await call(
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
  // 서버가 응답함 = 네트워크 OK → 밀린 이벤트 큐가 있으면 바로 전송(아침 묶음 전송 실패분 즉시 복구)
  if (queueHasEvents()) void flushEvents()
  return r
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
  if (initializing) await initializing
  if (flushing) return flushing
  flushing = flushQueue().finally(() => { flushing = null })
  const res = await flushing
  scheduleFlushRetry() // 실패·부분전송으로 큐가 남아있으면 10분 뒤 자동 재시도(아침 서버 기동 중 실패 복구)
  return res
}

// 큐에 보낼 이벤트가 남아있나
function queueHasEvents(): boolean {
  try {
    return !!queueFile && fs.existsSync(queueFile) && fs.readFileSync(queueFile, 'utf8').split('\n').filter(Boolean).length > 0
  } catch {
    return false
  }
}
// 큐가 남아있으면 10분 뒤 재시도 예약 — 중복 예약 방지, 큐가 빌 때까지 반복
function scheduleFlushRetry(): void {
  if (retryTimer || !queueHasEvents()) return
  retryTimer = setTimeout(async () => {
    retryTimer = null
    await flushEvents()
  }, FLUSH_RETRY_MS)
}

async function flushQueue(): Promise<{ sent: number }> {
  if (!token || !queueFile || !fs.existsSync(queueFile)) return { sent: 0 }
  let sent = 0
  const rejected = new Set<string>()
  while (true) {
    const lines = fs.readFileSync(queueFile, 'utf8').split('\n').filter(Boolean)
    const events = lines.map((line) => JSON.parse(line)).filter((e) => !rejected.has(e.client_event_id)).slice(0, FLUSH_MAX)
    if (!events.length) return { sent }
    try {
      const r = await call('POST', `${V}/events/batch`, { events }, { timeoutMs: 20000 })
      if (!Array.isArray(r.accepted_ids) || !Array.isArray(r.rejected_ids)) throw new Error('Invalid batch response')
      const submitted = new Set(events.map((e) => e.client_event_id))
      const done = new Set<string>(r.accepted_ids.filter((id: string) => submitted.has(id)))
      for (const id of r.rejected_ids) rejected.add(id)
      if (r.rejected_ids.length) console.warn('[api] rejected 이벤트는 큐에 보관:', r.rejected_ids.length)
      // 요청 중 추가된 이벤트도 포함해 다시 읽는다. accepted_ids만 삭제한다.
      const current = fs.readFileSync(queueFile, 'utf8').split('\n').filter(Boolean)
      const rest = current.filter((line) => !done.has(JSON.parse(line).client_event_id))
      const tmp = `${queueFile}.tmp`
      fs.writeFileSync(tmp, rest.length ? rest.join('\n') + '\n' : '')
      fs.renameSync(tmp, queueFile)
      sent += done.size
      if (!done.size || events.length < FLUSH_MAX) return { sent }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) token = null
      console.warn('[api] batch 실패; 큐 유지:', (e as Error).message)
      return { sent }
    }
  }
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

export interface ChatReply {
  reply: string
  source: string // 'bedrock'
  model_id: string
  latency_ms: number
}
/** 공감챗 1건 (M05) → 서버 /chat → Bedrock 프롬프트 응답. 503/502/429·타임아웃이면 throw → 호출 측이 규칙 응답(replyEmpathy)으로 폴백.
 *  원문은 서버가 저장하지 않음. 위기 키워드는 호출 전에 앱이 걸러서(isCrisis) 서버에 보내지 않는다. */
export async function postChat(message: string): Promise<ChatReply> {
  if (initializing) await initializing
  const r = await call('POST', `${V}/chat`, { message, client_event_id: uid() }, { timeoutMs: 15000 })
  if (!r || typeof r.reply !== 'string' || !r.reply.trim()) throw new Error('Invalid chat response')
  return r as ChatReply
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

/** Raw batch: only Backend-confirmed S3 persistence counts as an ACK. */
export async function uploadRawBatch(meta: Record<string, unknown>, compressed: Buffer): Promise<boolean> {
  if (!token) return false
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 60000)
  try {
    const response = await fetch(`${V}/raw/batches`, {
      method: 'POST', signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/gzip',
        'X-Raw-Batch-Meta': Buffer.from(JSON.stringify(meta), 'utf8').toString('base64url'),
      },
      body: new Uint8Array(compressed),
    })
    if (!response.ok) return false
    const ack = await response.json() as { stored?: boolean; already_exists?: boolean; batch_id?: string; sha256?: string }
    return (ack.stored === true || ack.already_exists === true) &&
      ack.batch_id === meta.batch_id && ack.sha256 === meta.sha256
  } catch (e) {
    console.warn('[raw-upload] Backend 통신 실패:', (e as Error).message)
    return false
  } finally {
    clearTimeout(timeout)
  }
}
