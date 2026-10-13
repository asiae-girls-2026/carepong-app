// 메인 프로세스 스트레스 매니저
// (10/2 D03) 개입 판정 = 서버 추론: 앱은 1분 창 16피처를 postWindow 로 올리고, 서버 응답 prompt 로만 팝업.
// 로컬 트래커(옛 가중합 휴리스틱)는 "지수 미터 표시"와 개발용 오프라인 데모(CAREPONG_DEV_SIM=1)에만 쓴다 — 판정 주체 아님.
import { BrowserWindow, ipcMain } from 'electron'
import crypto from 'node:crypto'
import { createStressTracker, STRESS_THRESHOLD, type StressSnapshot } from '../core/stress'
import * as api from './api'
import { scheduleCollector, setCollectorPaused, type CollectorLine } from './collector'
import { loadHealth, loadMorningGreetDay, saveMorningGreetDay } from './store'

// 로컬 날짜키 (YYYYMMDD) — 하루 1회 판정용
const localDayKey = (d = new Date()): number => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
const MORNING_START_MIN = 8 * 60 + 30 // 08:30
const MORNING_DELAY_MS = 30 * 60 * 1000 // 첫 활동 후 30분

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

const ALERT_SNOOZE_MS = 30 * 60 * 1000 // '나중에' 후 재알림 유예
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

  // ── 아침 인사 (좋은 아침이에요 ☀️) — 08:30 이후 '첫 키보드·마우스 활동' 30분 후 하루 1회 ──
  let morningTimer: ReturnType<typeof setTimeout> | null = null
  const maybeScheduleMorning = (features: Record<string, number>): void => {
    if (morningTimer) return // 이미 예약됨
    const today = localDayKey()
    if (loadMorningGreetDay() === today) return // 오늘 이미 인사함
    const d = new Date()
    if (d.getHours() * 60 + d.getMinutes() < MORNING_START_MIN) return // 08:30 이전
    const active = Object.values(features).some((v) => typeof v === 'number' && v > 0) // 키/마우스 활동 있는 창
    if (!active) return
    morningTimer = setTimeout(() => {
      morningTimer = null
      if (loadMorningGreetDay() === localDayKey()) return
      if (new Date().getHours() >= 12) return // 발동 시각이 정오 이후면 '좋은 아침'이 어색 → 건너뜀
      saveMorningGreetDay(localDayKey())
      broadcast('morning:greet')
    }, MORNING_DELAY_MS)
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
    maybeScheduleMorning(w.features) // 08:30 이후 첫 활동 감지 → 30분 뒤 아침 인사(하루 1회)
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
        score: r.condition_score ?? 0,
        markers: { kpm: 0, backspaceRatio: 0, mouseJerk: 0, clickRate: 0 },
        demo: false,
        windowId: r.window_id,
        promptType: r.prompt_type ?? 'spike',
        stressScore: r.condition_score ?? undefined,
      })
    }
  }
  ipcMain.on('collector:window', (_e, w: CollectorWindow) => void onServerWindow(w))

  // ── (10/7) 수집기 실행: collector.exe stdout 1줄 → onServerWindow. 08:30~18:30(방해금지 밖)만, 설정 1분마다 반영 ──
  ipcMain.on('collector:pause', (_e, on: boolean) => setCollectorPaused(on)) // 방해금지 수동 토글·수집 일시중지
  scheduleCollector(
    () => loadHealth(),
    (line: CollectorLine) => void onServerWindow({ windowStart: line.window_start, features: line.features, dnd: false }),
  )

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
