import type { MedSchedule, WaterConfig, MedTiming } from './scheduler'

export const TIMING_LABEL: Record<MedTiming, string> = {
  before_meal: '식전',
  after_meal: '식후',
  bedtime: '취침 전',
  empty_stomach: '공복',
  anytime: '아무때나',
}

// 복약 순응도 가이드(놓쳤을 때) — 일반 원칙
export const MISSED_DOSE_GUIDE =
  '깜빡했다면: 생각난 즉시 복용하되, 다음 복용 시간이 가까우면 건너뛰세요. 절대 2회분을 한꺼번에 드시지 마세요.'

export interface AuxConfig {
  stretchMin: number // 스트레칭 알람 간격(분), 0=끔 — 규칙서 기본 60분(30~90)
  restMin: number // 휴식 알람 간격(분), 0=끔 — 규칙서 초기 제안 50~90분 집중 후
}

export interface HealthConfig {
  memberId?: string // 개인 회원 고유번호 — 최초 실행 시 자동 발급, 데이터 관리·조인 키(person_id)
  medications: MedSchedule[]
  water: WaterConfig
  quietEnabled?: boolean // 방해금지 시간 사용 여부 (기본 사용)
  quietHours: { start: string; end: string }
  aux?: AuxConfig
  minimalMotion?: boolean // 펫 움직임 최소화(배회 X, 눈깜빡임만)
  petOpacity?: number // 케어펫 투명도 %(20~100, 기본 100) — 방해금지 중 펫 투명도 (기획서 11번)
}

// 기획서 v12: 스트레칭 기본 4시간(240분), 휴식 기본 2시간(120분)
export const DEFAULT_AUX: AuxConfig = { stretchMin: 240, restMin: 120 }

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  medications: [],
  water: { dailyTargetCups: 8, intervalMinutes: 90 },
  quietEnabled: true,
  // 방해금지 창 = 감지제외 창으로 일원화 (기획서 v7 11.설정 · 1차 기본 18:30~08:30 자동 ON/OFF)
  quietHours: { start: '18:30', end: '08:30' },
  aux: DEFAULT_AUX,
  minimalMotion: false,
  petOpacity: 40, // 방해금지 중 펫 기본 투명도 40%(예전 흐림). 사용자가 바꾸면 그 값으로 저장·유지(20~100)
}

// 기본 영양제 프리셋 — 선택 시 권장 섭취법 자동 입력(수정 가능)
export interface VitaminPreset {
  name: string
  timing: MedTiming
  note: string
}
export const VITAMIN_PRESETS: VitaminPreset[] = [
  { name: '비타민 C', timing: 'after_meal', note: '수용성. 식후 복용 권장, 고용량은 나눠서' },
  { name: '비타민 D', timing: 'after_meal', note: '지용성. 지방 있는 식사 후 흡수↑' },
  { name: '오메가3', timing: 'after_meal', note: '식후(지방과 함께) 흡수↑' },
  { name: '종합비타민', timing: 'after_meal', note: '식후 복용' },
  { name: '마그네슘', timing: 'bedtime', note: '취침 전 복용 시 이완·수면에 도움' },
  { name: '아연', timing: 'empty_stomach', note: '공복 흡수↑, 속 쓰리면 식후. 철분·칼슘과 시간 띄우기' },
  { name: '철분', timing: 'empty_stomach', note: '공복 흡수↑, 비타민C와 함께. 위장장애 시 식후' },
  { name: '유산균', timing: 'empty_stomach', note: '공복/식전, 위산 적을 때. 뜨거운 물 X' },
  { name: '칼슘', timing: 'after_meal', note: '식후, 1회 500mg 이하로 나눠서. 철분과 시간 띄우기' },
  { name: '비타민 B군', timing: 'after_meal', note: '아침 식후. 에너지 대사 도움' },
  { name: '루테인', timing: 'after_meal', note: '지용성. 식후 흡수↑' },
]

export function createMed(
  id: string,
  name: string,
  isSupplement: boolean,
  times: string[],
  days: number[],
  opts: { dose?: string; timing?: MedTiming; note?: string } = {},
): MedSchedule {
  return { id, name, isSupplement, times, days, ...opts }
}

export function addMed(config: HealthConfig, med: MedSchedule): HealthConfig {
  return { ...config, medications: [...config.medications, med] }
}

export function removeMed(config: HealthConfig, id: string): HealthConfig {
  return { ...config, medications: config.medications.filter((m) => m.id !== id) }
}

export function updateMed(
  config: HealthConfig,
  id: string,
  patch: Partial<MedSchedule>,
): HealthConfig {
  return {
    ...config,
    medications: config.medications.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  }
}

export function setWater(config: HealthConfig, water: WaterConfig): HealthConfig {
  return { ...config, water }
}

export function setQuiet(config: HealthConfig, quietHours: { start: string; end: string }): HealthConfig {
  return { ...config, quietHours }
}

export function setAux(config: HealthConfig, aux: AuxConfig): HealthConfig {
  return { ...config, aux }
}
