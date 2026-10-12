// 케어퐁 펫 모델 — 규칙서(PILLYMON 캐릭터키우기 9/22) 기반
// 죽음·게임오버 없음. 게이지 0이어도 시무룩/지침 표현만 한다.
export type LifeStage = 1 | 2 | 3 | 4 | 5

export interface Stats {
  health: number
  happiness: number
  energy: number
}

// 환생해도 리셋되지 않는 평생 기록 (리텐션용 누적)
export interface AncestorInfo {
  creature: string
  name: string
}

export interface LifetimeLog {
  care: number // 누적 돌봄 행동(밥·쓰다듬기·산책)
  alarms: number // 누적 알람 이행(약·물·스트레칭·휴식)
  reliefs: number // 누적 스트레스 개입 완료(심호흡·명상)
  chats: number // 누적 대화·기분 체크 — 미니홈 가구 언락 기준
}

export interface Pet {
  name: string
  creature: string
  stage: LifeStage // 레벨(Lv.1~5) — XP로 결정
  xp: number // 이번 생의 누적 XP (환생 시 0으로)
  stats: Stats
  birthday: number // 이번 생 시작 시각
  generation: number // 세대 — 몇 번째 아이인지 (환생마다 +1, 평생 유지)
  ancestors: AncestorInfo[] // 먼저 살던 아이들(외형+이름) — 미니홈·아카이브에 남는다
  speciesOrder?: string[] // 캐릭터 등장 순서 [첫 캐릭터, 다음…] — 첫 실행 시 랜덤 결정. 도감 번호·환생 순서 기준
  lifetime: LifetimeLog
  chatsDay: number // 오늘의 하트 게이지용 — 날짜 키(epoch day)
  chatsToday: number // 오늘 나눈 대화 수 (하트 10칸)
}

export const INITIAL_GAUGE = 70

export function createNewPet(name: string, creature: string, now: number, speciesOrder?: string[]): Pet {
  return {
    name,
    creature,
    stage: 1,
    xp: 0,
    stats: { health: INITIAL_GAUGE, happiness: INITIAL_GAUGE, energy: INITIAL_GAUGE },
    birthday: now,
    generation: 1,
    ancestors: [],
    speciesOrder: speciesOrder ?? [creature],
    lifetime: { care: 0, alarms: 0, reliefs: 0, chats: 0 },
    chatsDay: 0,
    chatsToday: 0,
  }
}
