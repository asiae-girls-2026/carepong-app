import type { DecayRates } from './stats'

// ── 게이지 자연 감소 — 규칙서: 행복 -16 / 건강 -12 / 기력 -20 per '활성일' ──
// 활성일 = 앱이 켜져 있는 시간 기준. 하루 활성 8시간 가정으로 시간당 감소율을 도출(초기 제안값).
export const ACTIVE_DAY_HOURS = 8
export const DEFAULT_DECAY_RATES: DecayRates = {
  happinessPerHour: 16 / ACTIVE_DAY_HOURS, // 2.0
  healthPerHour: 12 / ACTIVE_DAY_HOURS, // 1.5
  energyPerHour: 20 / ACTIVE_DAY_HOURS, // 2.5
}

// ── 자연 감소: 하루 3회 고정 드롭 (기획서 v10: 11·14·17시, 각 −16/−12/−20) ──
// 앱이 켜져 있고 방해금지 밖일 때만 적용(앱 꺼진 시간·방해금지 창엔 미발생)
export const DECAY_HOURS = [11, 14, 17] as const
export const DECAY_DROP = { happiness: 16, health: 12, energy: 20 }

// ── 돌봄 행동 보상 (규칙서 4.돌봄 행동 — 초기 제안값, 미이행 벌점 없음) ──
export const CARE_FEED = { health: 8, happiness: 5, energy: 12, xp: 10 }
export const CARE_PAT = { health: 3, happiness: 12, energy: 0, xp: 10 }
// 산책 기력 소모 −12 (기획서 v7 4.돌봄 H7 · 5.게이지 E7 · 13.확정)
export const CARE_WALK = { health: 10, happiness: 8, energy: -12, xp: 15 }

// ── 행동 알람 이행 보상 (규칙서 2.행동 알람 — 미이행 벌점 없음) ──
export const ALARM_MED = { energy: 10, xp: 10 } // 약·영양제: 사용자 스케줄 기반
export const ALARM_WATER = { health: 5, xp: 5 }
export const ALARM_STRETCH = { health: 5, happiness: 3, xp: 5 }
// 휴식 = 기력+8만 (기획서 v7 2.행동 알람 휴식 행: 건강±0·행복±0·기력+8·XP+5)
export const ALARM_REST = { energy: 8, xp: 5 }

// ── 스트레스 개입 완료 보상 (규칙서 3.스트레스 개입) ──
export const RELIEF_BREATH = { happiness: 10, energy: 8, xp: 15 } // 심호흡 ~57초 (기획서 3-1: 행복+10·기력+8)
export const RELIEF_MEDITATE = { happiness: 12, energy: 10, xp: 15 } // 명상 90초 — 심호흡보다 이완 높게(기획서 3-1 A18: 행복+12·기력+10)

// ── 기력 '과다 방지 리미트' (규칙서 5.상태 게이지 — 거짓 보고 억제, 의료 진단 아님) ──
export const ENERGY_OVERLOAD_AT = 95 // 이 이상 지속되면 '무리/과다 주의'
export const ENERGY_OVERLOAD_SUSTAIN_MS = 30 * 60 * 1000
export const MED_PRIORITY_NOTICE = '약은 처방·약사 지시가 우선이에요' // 고정 문구

export const DEFAULT_CREATURE = 'cat'

export const TICK_INTERVAL_MS = 60 * 1000
export const NIGHT_ENERGY_REGEN = 4 // 밤(방해금지) 1틱당 기력 회복량
export const REMINDER_CHECK_MS = 30 * 1000 // 알림 도래 점검 주기
