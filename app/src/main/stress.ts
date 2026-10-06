// 메인 프로세스 스트레스 매니저
// (10/2 D03) 개입 판정 = 서버 추론: 앱은 1분 창 16피처를 postWindow 로 올리고, 서버 응답 prompt 로만 팝업.
// 로컬 트래커(옛 가중합 휴리스틱)는 "지수 미터 표시"와 개발용 오프라인 데모(CAREPONG_DEV_SIM=1)에만 쓴다 — 판정 주체 아님.
import { BrowserWindow, ipcMain } from 'electron'
import crypto from 'node:crypto'
import { createStressTracker, STRESS_THRESHOLD, type StressSnapshot } from '../core/stress'
import * as api from './api'

export type StressEvent =
  | { type: 'key'; backspace: boolean }
  | { type: 'click' }
  | { type: 'mouse'; x: number; y: number; t: number }

// 렌더러로 보내는 개입 알림 — 서버 postWindow 응답 맥락을 함께 싣는다(자가보고용)
export interface StressAlert extends StressSnapshot {
  windowId?: string | null
  promptType?: string
  stressScore?: number
  nthToday?: number
}

// 수집기(collector.exe) stdout 1줄 = 1분 창. app 은 그대로 postWindow 로 올림(호출위치표 B)
export interface CollectorWindow {
  sessionId?: string
  windowStart?: string
  features: Record<string, number> // 16피처 (SnKeyStrokes … SnMouseDistance) — 수집기가 산출
  dnd?: boolean
}

const ALERT_SNOOZE_MS = 10 * 60 * 1000 // '나중에' 후 재알림 유예
// 규칙서 3.스트레스 개입(앱 측 레이어): 하루 개입 상한 3회 + 쿨다운 — 서버 prompt 여부와 별개로 과잉 개입 차단
const DAILY_CAP = 3
const COOLDOWN_MS = 30 * 60 * 1000

export function initStressManager(): void {
  const tracker = createStressTracker()
  const sessionId = crypto.randomUUID()
  let alerted = false
  let snoozeUntil = 0
  let alertsToday = 0
  let alertDay = new Date().getDate()
  let lastAlertAt = 0

  const broadcast = (channel: string, payload?: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload)
    }
  }

  const rollDay = (): void => {
    const today = new Date().getDate()
    if (today !== alertDay) {
      alertDay = today
      alertsToday = 0 // 자정 지나면 하루 상한 리셋
    }
  }
  // 앱 측 개입 게이트 — 상한·쿨다운·스누즈·중복 방지 (서버 prompt 가 떠도 이걸 통과해야 팝업)
  const canIntervene = (now: number, demo = false): boolean =>
    !alerted && now >= snoozeUntil && (alertsToday < DAILY_CAP && now - lastAlertAt >= COOLDOWN_MS || demo)

  const fireAlert = (now: number, payload: StressAlert): void => {
    alerted = true
    alertsToday++
    lastAlertAt = now
    broadcast('stress:alert', { ...payload, nthToday: alertsToday })
  }

  // ── 마커 수집 (지수 미터용) ──
  ipcMain.on('stress:event', (_e, ev: StressEvent) => {
    const now = Date.now()
    if (ev.type === 'key') tracker.addKey(now, ev.backspace)
    else if (ev.type === 'click') tracker.addClick(now)
    else if (ev.type === 'mouse') tracker.addMouseSample(ev.x, ev.y, ev.t)
  })
  ipcMain.on('stress:demo', (_e, on: boolean) => tracker.setDemo(on))
  ipcMain.on('stress:snooze', () => {
    snoozeUntil = Date.now() + ALERT_SNOOZE_MS
    alerted = false
  })
  ipcMain.on('stress:calm', () => {
    tracker.calm()
    alerted = false
    snoozeUntil = 0
    broadcast('stress:calmed')
  })
  ipcMain.handle('stress:get', (): StressSnapshot => ({
    score: tracker.getScore(),
    markers: { kpm: 0, backspaceRatio: 0, mouseJerk: 0, clickRate: 0 },
    demo: tracker.isDemo(),
  }))

  // ── 지수 미터 틱(1초) — 화면 표시용. 개입 판정은 하지 않는다 ──
  setInterval(() => {
    rollDay()
    const snap = tracker.tick(Date.now())
    broadcast('stress:update', snap)
    if (snap.score < STRESS_THRESHOLD - 20) alerted = false // 자연 회복되면 재개입 가능
  }, 1000)

  // ── 실제 감지 경로 (호출위치표 B) : 수집기 1분 창 → 서버 postWindow → 서버 prompt 로만 팝업 ──
  // collector.exe 가 stdout 으로 1분 창(16피처)을 주면 main 에서 'collector:window' 로 넘겨 호출한다.
  // 수집기·서버가 아직 안 붙었으면 이 경로는 호출되지 않으므로 자동 개입은 발생하지 않는다(= 기획서: 서버가 판정 주체).
  const onServerWindow = async (w: CollectorWindow): Promise<void> => {
    let r
    try {
      r = await api.postWindow({
        sessionId: w.sessionId ?? sessionId,
        windowStart: w.windowStart ?? new Date().toISOString(),
        features: w.features,
        dnd: w.dnd ?? false,
      })
    } catch (e) {
      console.warn('[stress] postWindow 실패(개입 생략):', (e as Error).message)
      return
    }
    const now = Date.now()
    rollDay()
    if (r.prompt && canIntervene(now)) {
      fireAlert(now, {
        score: r.stress_score,
        markers: { kpm: 0, backspaceRatio: 0, mouseJerk: 0, clickRate: 0 },
        demo: false,
        windowId: r.window_id,
        promptType: r.prompt_type ?? 'spike',
        stressScore: r.stress_score,
      })
    }
  }
  ipcMain.on('collector:window', (_e, w: CollectorWindow) => void onServerWindow(w))

  // ── 개발용 오프라인 데모: 수집기·서버 없이 로컬 임계로 팝업 (CAREPONG_DEV_SIM=1 일 때만) ──
  // ⚠ 실제 판정 아님 — 데모·UI 확인용. 운영에선 끄고 collector:window 경로만 쓴다.
  if (process.env.CAREPONG_DEV_SIM === '1') {
    setInterval(() => {
      const now = Date.now()
      rollDay()
      const snap = tracker.tick(now)
      if (snap.score >= STRESS_THRESHOLD && canIntervene(now, snap.demo)) {
        fireAlert(now, { ...snap, windowId: null, promptType: 'spike', stressScore: snap.score })
      }
    }, 1000)
  }
}
