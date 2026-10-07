import type { HealthConfig } from './health'
import { DEFAULT_AUX } from './health'
import { isMedicationDue, isWaterDue, startOfLocalDay } from './scheduler'

export interface IntakeLog {
  medsTakenAt: Record<string, number>
  waterDayStart: number
  waterCups: number
  lastDrinkAt: number | null
  lastStretchAt: number | null // 스트레칭 알람 이행/발동 기준 시각
  lastRestAt: number | null // 휴식 알람 이행/발동 기준 시각
  medConfirmed?: number // 누적 복약 확인 횟수
  medMissed?: number // 누적 복약 놓침(무시) 횟수 — 벌점 없음, 통계용
  xpDay?: number // XP 상한용 날짜 키(epoch day)
  xpCounts?: Record<string, number> // 파트별 오늘 XP 적립 횟수 (med/water/stretch/rest/feed/pat/walk)
  feedTimes?: number[] // 최근 밥 시각(배부름 판정용)
  reliefDay?: number // 완화 보상 상한용 날짜 키(epoch day)
  reliefCount?: number // 오늘 완화 보상 지급 횟수 — 심호흡+명상 합산
  lastReliefRewardAt?: number // 마지막 완화 보상 시각(쿨다운 30분)
}

export const EMPTY_INTAKE: IntakeLog = {
  medsTakenAt: {},
  waterDayStart: 0,
  waterCups: 0,
  lastDrinkAt: null,
  lastStretchAt: null,
  lastRestAt: null,
  medConfirmed: 0,
  medMissed: 0,
}

export function rollWaterDay(log: IntakeLog, now: number): IntakeLog {
  const today = startOfLocalDay(now)
  if (log.waterDayStart === today) return log
  return { ...log, waterDayStart: today, waterCups: 0 }
}

export function recordMed(log: IntakeLog, medId: string, now: number): IntakeLog {
  return {
    ...log,
    medsTakenAt: { ...log.medsTakenAt, [medId]: now },
    medConfirmed: (log.medConfirmed ?? 0) + 1,
  }
}

// 복약 알람을 무시(자동 사라짐)했을 때 — 놓침 1회 기록만. 게이지 벌점 없음(규칙서 원칙).
export function recordMiss(log: IntakeLog): IntakeLog {
  return { ...log, medMissed: (log.medMissed ?? 0) + 1 }
}

// 복약 순응률(%) = 복용 / (복용 + 놓침). 기록 없으면 100%로 본다.
export function adherenceRate(log: IntakeLog): { rate: number; taken: number; missed: number } {
  const taken = log.medConfirmed ?? 0
  const missed = log.medMissed ?? 0
  const total = taken + missed
  return { rate: total === 0 ? 100 : Math.round((taken / total) * 100), taken, missed }
}

export function recordWater(log: IntakeLog, now: number): IntakeLog {
  const rolled = rollWaterDay(log, now)
  return { ...rolled, waterCups: rolled.waterCups + 1, lastDrinkAt: now }
}

export function recordStretch(log: IntakeLog, now: number): IntakeLog {
  return { ...log, lastStretchAt: now }
}

export function recordRest(log: IntakeLog, now: number): IntakeLog {
  return { ...log, lastRestAt: now }
}

// ── XP 파트별 하루 상한 (기획서 v10: 알람 4종·돌봄 3종 각각 하루 3회까지만 XP) ──
export const XP_DAILY_CAP = 3
export type XpPart = 'med' | 'water' | 'stretch' | 'rest' | 'feed' | 'pat' | 'walk'

function rollXpDay(log: IntakeLog, now: number): IntakeLog {
  const day = Math.floor(now / 86_400_000)
  if (log.xpDay === day) return log
  return { ...log, xpDay: day, xpCounts: {} }
}
// 오늘 이 파트가 아직 XP를 받을 수 있나 (3회 미만)
export function canGrantXp(log: IntakeLog, part: XpPart, now: number): boolean {
  const rolled = rollXpDay(log, now)
  return (rolled.xpCounts?.[part] ?? 0) < XP_DAILY_CAP
}
// XP 적립 1회 기록 (게이지와 무관, XP만)
export function grantXp(log: IntakeLog, part: XpPart, now: number): IntakeLog {
  const rolled = rollXpDay(log, now)
  const count = (rolled.xpCounts?.[part] ?? 0) + 1
  return { ...rolled, xpCounts: { ...(rolled.xpCounts ?? {}), [part]: count } }
}

// ── 밥 배부름 (기획서 v10: 최근 1시간 내 3회 먹으면 배부름 → 쿨다운 1시간) ──
const FEED_WINDOW_MS = 60 * 60 * 1000
export const FEED_LIMIT = 3
export function recentFeeds(log: IntakeLog, now: number): number {
  return (log.feedTimes ?? []).filter((t) => now - t < FEED_WINDOW_MS).length
}
export function isFull(log: IntakeLog, now: number): boolean {
  return recentFeeds(log, now) >= FEED_LIMIT
}
export function recordFeed(log: IntakeLog, now: number): IntakeLog {
  const recent = (log.feedTimes ?? []).filter((t) => now - t < FEED_WINDOW_MS)
  return { ...log, feedTimes: [...recent, now] }
}

// ── 완화 보상 상한 (기획서 3-1·3-2: 심호흡+명상 합산 하루 3회 · 쿨다운 30분, 앱 측) ──
export const RELIEF_DAILY_CAP = 3
export const RELIEF_COOLDOWN_MS = 30 * 60 * 1000
function rollReliefDay(log: IntakeLog, now: number): IntakeLog {
  const day = Math.floor(now / 86_400_000)
  if (log.reliefDay === day) return log
  return { ...log, reliefDay: day, reliefCount: 0 }
}
// 지금 완화 보상을 줄 수 있나 (오늘 3회 미만 AND 마지막 보상에서 30분 경과). 공감챗봇은 미포함.
export function canGrantRelief(log: IntakeLog, now: number, ignoreCooldown = false): boolean {
  const r = rollReliefDay(log, now)
  if ((r.reliefCount ?? 0) >= RELIEF_DAILY_CAP) return false
  // QA 모드에선 30분 쿨다운을 건너뛰어 하루 3회 보상을 연속 테스트 가능(하루 3회 상한은 유지)
  if (!ignoreCooldown && r.lastReliefRewardAt && now - r.lastReliefRewardAt < RELIEF_COOLDOWN_MS) return false
  return true
}
export function grantRelief(log: IntakeLog, now: number): IntakeLog {
  const r = rollReliefDay(log, now)
  return { ...r, reliefCount: (r.reliefCount ?? 0) + 1, lastReliefRewardAt: now }
}

export type ReminderKind = 'medication' | 'water' | 'stretch' | 'rest'

export interface DueReminder {
  kind: ReminderKind
  id: string
  label: string
}

// 간격형 알람(스트레칭·휴식) 도래 판정 — 기준 시각이 없으면 sessionStart부터 센다.
function isIntervalDue(now: number, last: number | null, sessionStart: number, minutes: number): boolean {
  if (minutes <= 0) return false
  const base = last ?? sessionStart
  return now - base >= minutes * 60 * 1000
}

// 알람 4종(약·물·스트레칭·휴식) 도래 목록 — 우선순위 순.
// sessionStart = 앱 시작 시각(스트레칭/휴식은 켠 뒤 한 간격이 지나야 첫 알람).
export function dueReminders(
  config: HealthConfig,
  log: IntakeLog,
  now: number,
  sessionStart: number,
): DueReminder[] {
  const dayStart = startOfLocalDay(now)
  const out: DueReminder[] = []
  for (const med of config.medications) {
    if (isMedicationDue(med, now, log.medsTakenAt[med.id] ?? null, dayStart)) {
      out.push({ kind: 'medication', id: med.id, label: med.name })
    }
  }
  const rolled = rollWaterDay(log, now)
  if (isWaterDue(config.water, now, rolled.lastDrinkAt, rolled.waterCups)) {
    out.push({ kind: 'water', id: 'water', label: '물 마시기' })
  }
  // 스트레칭·휴식은 건강 펫의 기본 알람 — 끌 수 없다. 0(옛 데이터)이면 기본 간격으로 동작.
  const aux = config.aux ?? DEFAULT_AUX
  const stretchMin = aux.stretchMin > 0 ? aux.stretchMin : DEFAULT_AUX.stretchMin
  const restMin = aux.restMin > 0 ? aux.restMin : DEFAULT_AUX.restMin
  if (isIntervalDue(now, log.lastStretchAt ?? null, sessionStart, stretchMin)) {
    out.push({ kind: 'stretch', id: 'stretch', label: '스트레칭' })
  }
  if (isIntervalDue(now, log.lastRestAt ?? null, sessionStart, restMin)) {
    out.push({ kind: 'rest', id: 'rest', label: '잠깐 휴식' })
  }
  return out
}
