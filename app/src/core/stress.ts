// 스트레스 디지털 마커 산식 엔진 (순수 로직 — 웹 프로토타입에서 검증한 산식 이식)
// 최근 60초 이동 창에서 키보드·마우스 마커를 집계해 0~100 지수를 계산한다.

export interface StressMarkers {
  kpm: number // 분당 키 입력
  backspaceRatio: number // 백스페이스 비율 (0~1)
  mouseJerk: number // 마우스 급가속 (|Δ속도| 지수평활)
  clickRate: number // 분당 클릭
}

export interface StressSnapshot {
  score: number
  markers: StressMarkers
  demo: boolean
}

export const STRESS_THRESHOLD = 70 // 개입 임계값
export const CALM_RESET = 18 // 완화 완료 후 지수
const WINDOW_MS = 60_000
const EMA_ALPHA = 0.18
const DEMO_STEP = 8
const DEMO_CAP = 93

// 마커 정규화 상한
const KPM_MAX = 220
const BS_MAX = 0.25
const JERK_MAX = 9000
const CLICK_MAX = 40
// 가중치
const W_KPM = 0.28
const W_BS = 0.27
const W_JERK = 0.3
const W_CLICK = 0.15

export interface StressTracker {
  addKey(now: number, backspace: boolean): void
  addClick(now: number): void
  addMouseSample(x: number, y: number, t: number): void
  setDemo(on: boolean): void
  isDemo(): boolean
  calm(): void
  tick(now: number): StressSnapshot
  getScore(): number
}

export function createStressTracker(): StressTracker {
  let keys: number[] = []
  let backspaces: number[] = []
  let clicks: number[] = []
  const mouse = { x: 0, y: 0, t: 0, v: 0, jerkEma: 0 }
  let score = 12
  let demo = false

  return {
    addKey(now, backspace) {
      keys.push(now)
      if (backspace) backspaces.push(now)
    },
    addClick(now) {
      clicks.push(now)
    },
    addMouseSample(x, y, t) {
      if (mouse.t > 0) {
        const dt = t - mouse.t
        if (dt > 8) {
          const dist = Math.hypot(x - mouse.x, y - mouse.y)
          const v = (dist / dt) * 1000 // px/s
          const accel = Math.abs(v - mouse.v) / (dt / 1000)
          mouse.jerkEma = mouse.jerkEma * 0.92 + accel * 0.08
          mouse.v = v
          mouse.t = t
          mouse.x = x
          mouse.y = y
        }
      } else {
        mouse.t = t
        mouse.x = x
        mouse.y = y
      }
    },
    setDemo(on) {
      demo = on
    },
    isDemo() {
      return demo
    },
    calm() {
      keys = []
      backspaces = []
      clicks = []
      mouse.jerkEma = 0
      score = CALM_RESET
      demo = false
    },
    getScore() {
      return Math.round(score)
    },
    tick(now) {
      const cutoff = now - WINDOW_MS
      keys = keys.filter((t) => t > cutoff)
      backspaces = backspaces.filter((t) => t > cutoff)
      clicks = clicks.filter((t) => t > cutoff)
      mouse.jerkEma *= 0.97 // 가만히 있으면 서서히 안정

      const kpm = keys.length
      const backspaceRatio = kpm > 0 ? backspaces.length / kpm : 0
      const mouseJerk = Math.round(mouse.jerkEma)
      const clickRate = clicks.length

      const raw =
        100 *
        (W_KPM * Math.min(kpm / KPM_MAX, 1) +
          W_BS * Math.min(backspaceRatio / BS_MAX, 1) +
          W_JERK * Math.min(mouseJerk / JERK_MAX, 1) +
          W_CLICK * Math.min(clickRate / CLICK_MAX, 1))

      score = demo
        ? Math.min(score + DEMO_STEP, DEMO_CAP) // 시뮬레이션: 감쇠 없이 상승
        : score * (1 - EMA_ALPHA) + raw * EMA_ALPHA

      return {
        score: Math.round(score),
        markers: { kpm, backspaceRatio, mouseJerk, clickRate },
        demo,
      }
    },
  }
}
