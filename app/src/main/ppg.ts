// 2차 PPG(HRV) 측정 — 완료 감지 (docs: API 명세서 · carepong-ppg-hrv)
//
// 폰(측정웹)이 원파형을 서버로 보내 계산·판정하고, 앱은 "측정이 끝났는지"만 감지한다.
// 폰↔앱 직접 통신은 없고, 서버가 session_id 로 1:1 매칭해 통지한다.
//   · /v1/events (SSE, 추천)  — 측정 끝나는 순간 1번 push
//   · /v1/latest (폴링, 폴백) — 최신 결과 조회
// 이 서버는 공감챗봇·이벤트 수집 서버(api.ts)와 완전히 다른 독립 인스턴스다(명세 "서버 분리").
// 그래서 api.ts 의 call()·토큰을 쓰지 않고, 여기서 직접 fetch 한다.

// 측정 API 서버 주소 — 측정웹(vercel)과 별개의 판정·저장 서버(onrender).
// 주소가 바뀌면 여기 한 줄만 고치면 된다(환경변수로도 덮어쓸 수 있게).
export const PPG_API_BASE =
  process.env['PPG_API_BASE'] ?? 'https://carepong-ppg.onrender.com'

// 서버가 돌려주는 측정 결과(명세 응답·완료감지 공통)
export interface PpgResult {
  id?: string // measurement_id
  status: 'ok' | 'low_quality' | 'insufficient_beats' | 'error' | string
  score?: number // 0~100 고부하 점수
  grade?: '저' | '관찰' | '고' | string // 경계 38.5/65.7
  verdict?: 'deny' | 'observe' | 'confirm' | string
  used_reference?: 'personal' | 'coldstart' | string
}

// 감시 결과를 렌더러로 돌려줄 때의 래퍼
export type PpgWatchOutcome =
  | { kind: 'result'; sessionId: string; result: PpgResult } // 측정 완료(결과 수신)
  | { kind: 'timeout'; sessionId: string } // 2~3분 무응답 또는 세션 만료
  | { kind: 'cancelled'; sessionId: string } // 앱이 모달 닫음 등으로 취소
  | { kind: 'error'; sessionId: string; message: string } // 네트워크 등 오류

// 세션 수명(명세): QR 발급 후 5~10분. 무응답 타임아웃은 그 안에서 더 짧게(기본 3분).
const SESSION_TTL_MS = 10 * 60 * 1000 // 세션 만료 상한
const NO_RESPONSE_MS = 3 * 60 * 1000 // 측정 무응답 타임아웃(명세 ②~③ 2~3분)
const POLL_INTERVAL_MS = 3000 // 폴링 간격(SSE 실패 시 폴백)

interface Watch {
  sessionId: string
  controller: AbortController // SSE/폴링 중단용
  timer: ReturnType<typeof setTimeout> | null
  pollTimer: ReturnType<typeof setInterval> | null
  done: boolean
  onOutcome: (o: PpgWatchOutcome) => void
}

const watches = new Map<string, Watch>()

function finish(w: Watch, o: PpgWatchOutcome): void {
  if (w.done) return
  w.done = true
  if (w.timer) clearTimeout(w.timer)
  if (w.pollTimer) clearInterval(w.pollTimer)
  try { w.controller.abort() } catch { /* 무시 */ }
  watches.delete(w.sessionId)
  try { w.onOutcome(o) } catch { /* 콜백 오류 무시 */ }
}

// SSE 한 줄(event:/data:)로 온 측정 결과를 파싱 → 완료면 finish
function handleSseChunk(w: Watch, buffer: string): string {
  // 이벤트는 빈 줄(\n\n)로 구분된다. 완전한 블록만 처리하고 나머지는 버퍼에 남긴다.
  let idx: number
  while ((idx = buffer.indexOf('\n\n')) >= 0) {
    const block = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 2)
    let ev = 'message'
    const dataLines: string[] = []
    for (const raw of block.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (line.startsWith('event:')) ev = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (ev === 'result' && dataLines.length) {
      try {
        const result = JSON.parse(dataLines.join('\n')) as PpgResult
        finish(w, { kind: 'result', sessionId: w.sessionId, result })
        return ''
      } catch { /* 깨진 JSON 무시 — 다음 블록 대기 */ }
    }
  }
  return buffer
}

// SSE 연결(추천). 실패/끊김 시 폴링으로 폴백.
async function connectSse(w: Watch): Promise<void> {
  const url = `${PPG_API_BASE}/v1/events?session_id=${encodeURIComponent(w.sessionId)}`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: w.controller.signal,
    })
    if (!res.ok || !res.body) { startPolling(w); return }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    // 스트리밍 수신 루프
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = handleSseChunk(w, buffer)
      if (w.done) return
    }
    // 스트림이 결과 없이 끝남 → 폴링으로 폴백(서버가 keep-alive 안 하는 경우)
    if (!w.done) startPolling(w)
  } catch (e) {
    if (w.done) return
    if ((e as Error).name === 'AbortError') return // 취소됨
    startPolling(w) // SSE 미지원·네트워크 순간 오류 → 폴링 폴백
  }
}

// 폴링 폴백 — /v1/latest?session_id= 를 주기적으로 조회해 결과가 생기면 finish
function startPolling(w: Watch): void {
  if (w.done || w.pollTimer) return
  const url = `${PPG_API_BASE}/v1/latest?session_id=${encodeURIComponent(w.sessionId)}`
  const tick = async (): Promise<void> => {
    if (w.done) return
    try {
      const res = await fetch(url, { signal: w.controller.signal })
      if (!res.ok) return
      const data = (await res.json()) as { found?: boolean } & PpgResult
      if (data && data.found) {
        finish(w, { kind: 'result', sessionId: w.sessionId, result: data })
      }
    } catch { /* 네트워크 일시 오류 — 다음 tick 에서 재시도 */ }
  }
  w.pollTimer = setInterval(tick, POLL_INTERVAL_MS)
  void tick() // 즉시 1회
}

// 세션 감시 시작 — SSE 열고 타임아웃 설정. 결과/타임아웃/오류는 onOutcome 으로 1회 통지.
export function watchSession(sessionId: string, onOutcome: (o: PpgWatchOutcome) => void): void {
  if (!sessionId) { onOutcome({ kind: 'error', sessionId, message: 'no session' }); return }
  // 같은 세션 중복 감시 방지 — 기존 것 취소하고 새로 시작
  const prev = watches.get(sessionId)
  if (prev) finish(prev, { kind: 'cancelled', sessionId })

  const w: Watch = {
    sessionId,
    controller: new AbortController(),
    timer: null,
    pollTimer: null,
    done: false,
    onOutcome,
  }
  watches.set(sessionId, w)
  // 무응답 타임아웃(세션 만료 상한보다 짧게). 둘 중 먼저 오는 값으로.
  const ttl = Math.min(NO_RESPONSE_MS, SESSION_TTL_MS)
  w.timer = setTimeout(() => finish(w, { kind: 'timeout', sessionId }), ttl)
  void connectSse(w)
}

// 앱이 모달을 닫는 등으로 감시를 중단
export function cancelSession(sessionId: string): void {
  const w = watches.get(sessionId)
  if (w) finish(w, { kind: 'cancelled', sessionId })
}

// 앱 종료 시 전부 정리
export function cancelAllSessions(): void {
  for (const w of [...watches.values()]) finish(w, { kind: 'cancelled', sessionId: w.sessionId })
}
