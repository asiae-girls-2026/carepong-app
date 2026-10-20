import Store from 'electron-store'
import { randomBytes } from 'crypto'
import type { Pet } from '../core/types'
import { type HealthConfig, DEFAULT_HEALTH_CONFIG } from '../core/health'
import { type IntakeLog, EMPTY_INTAKE } from '../core/intake'

export interface PersistedState {
  pet: Pet
  position: { x: number; y: number }
  lastTickAt: number
  manualDnd?: boolean // 수동 방해금지 ON/OFF — 저장·복원용(야간 자동은 health의 dnd_schedule로 산출). 구버전 저장본 호환 위해 옵셔널
}

const store = new Store<{
  state: PersistedState | null
  health: HealthConfig
  intake: IntakeLog
  morningGreetDay: number | null // 아침 인사(좋은 아침이에요 ☀️) 마지막으로 띄운 날(로컬 날짜키) — 하루 1회 보장
}>({
  defaults: { state: null, health: DEFAULT_HEALTH_CONFIG, intake: EMPTY_INTAKE, morningGreetDay: null },
})

export function loadState(): PersistedState | null {
  return store.get('state')
}
export function saveState(state: PersistedState): void {
  store.set('state', state)
}
export function loadHealth(): HealthConfig {
  const h = store.get('health')
  // 회원번호 최초 발급 — 기기 로컬 고유번호(개인정보와 연결되지 않음)
  if (!h.memberId) {
    const next = { ...h, memberId: 'CP-' + randomBytes(4).toString('hex').toUpperCase() }
    store.set('health', next)
    return next
  }
  return h
}
export function saveHealth(config: HealthConfig): void {
  store.set('health', config)
}
export function loadIntake(): IntakeLog {
  return store.get('intake')
}
export function saveIntake(log: IntakeLog): void {
  store.set('intake', log)
}
export function loadMorningGreetDay(): number | null {
  return store.get('morningGreetDay')
}
export function saveMorningGreetDay(day: number): void {
  store.set('morningGreetDay', day)
}
