export type MedTiming = 'before_meal' | 'after_meal' | 'bedtime' | 'empty_stomach' | 'anytime'

export interface MedSchedule {
  id: string
  name: string
  item_type?: 'DRUG' | 'HFF' // 기존 로컬 등록과 호환
  product_id?: number
  external_id?: string | null
  manufacturer_name?: string | null
  isSupplement: boolean
  times: string[] // "HH:MM" 24시간 표기
  days: number[] // 0=일 ~ 6=토, 빈 배열이면 매일
  dose?: string // 용량 (예: "1정", "2캡슐")
  timing?: MedTiming // 복용 타이밍
  note?: string // 주의사항 메모 (예: "물과 함께", "자몽주스 금지")
}

export interface WaterConfig {
  dailyTargetCups: number
  intervalMinutes: number
}

function parseHHMM(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(':').map(Number)
  return { hours: h, minutes: m }
}

export function startOfLocalDay(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime()
}

export function scheduledTimesForDay(med: MedSchedule, dayStart: number): number[] {
  const d = new Date(dayStart)
  if (med.days.length > 0 && !med.days.includes(d.getDay())) return []
  return med.times.map((t) => {
    const { hours, minutes } = parseHHMM(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes, 0, 0).getTime()
  })
}

export function isMedicationDue(
  med: MedSchedule,
  now: number,
  lastTakenAt: number | null,
  dayStart: number,
): boolean {
  const passed = scheduledTimesForDay(med, dayStart).filter((t) => t <= now)
  if (passed.length === 0) return false
  const mostRecent = Math.max(...passed)
  return lastTakenAt === null || lastTakenAt < mostRecent
}

export function cupsRemaining(config: WaterConfig, cupsToday: number): number {
  return Math.max(0, config.dailyTargetCups - cupsToday)
}

export function isWaterDue(
  config: WaterConfig,
  now: number,
  lastDrinkAt: number | null,
  cupsToday: number,
): boolean {
  if (cupsRemaining(config, cupsToday) <= 0) return false
  if (lastDrinkAt === null) return true
  return now - lastDrinkAt >= config.intervalMinutes * 60 * 1000
}

// 방해금지 시간대 판정 (자정 넘는 구간 지원). start/end = "HH:MM"
export function isWithinQuiet(now: number, start: string, end: string): boolean {
  const d = new Date(now)
  const cur = d.getHours() * 60 + d.getMinutes()
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const s = sh * 60 + sm
  const e = eh * 60 + em
  if (s === e) return false
  if (s < e) return cur >= s && cur < e
  return cur >= s || cur < e
}
