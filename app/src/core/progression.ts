// 레벨·XP·만렙 환생 — 규칙서(6.레벨 성장 / 7.만렙 환생) 그대로.
// 초반 빠르게, 뒤로 갈수록 느리게 · 적극 이용 시 약 1~1.5개월 만렙 · 모든 수치 초기 제안값.
import type { AncestorInfo, LifeStage, Pet } from './types'
import { INITIAL_GAUGE } from './types'

// Lv.1~5 누적 XP 임계 (기획서 v7 6.레벨 성장: Lv.2=300, Lv.3=1,350, Lv.4=3,150, Lv.5=5,400)
export const XP_CUMULATIVE = [0, 300, 1350, 3150, 5400] as const
export const MAX_LEVEL: LifeStage = 5
// 기획서 v14: Lv.5 진입=5,400 / 환생(다음 캐릭터)=6,750 (Lv.5에서 1,350 더). XP는 6,750에서 멈춤
export const LV5_XP = XP_CUMULATIVE[4] // 5,400 — Lv.5(만렙 레벨) 진입
export const REBIRTH_XP = 6750 // 환생(다음 캐릭터) 트리거
export const MAX_XP = REBIRTH_XP // XP 상한(환생 시 0으로 리셋)

// 캐릭터 3종 — 환생할 때마다 순서대로 다음 외형으로 바뀐다(규칙서: 외형이 '한 번' 바뀜)
export const CREATURES = ['cat', 'quokka', 'dog'] as const

export function stageForXp(xp: number): LifeStage {
  let stage = 1
  for (let i = 1; i < XP_CUMULATIVE.length; i++) {
    if (xp >= XP_CUMULATIVE[i]) stage = i + 1
  }
  return Math.min(stage, MAX_LEVEL) as LifeStage
}

// 환생 가능 여부 (Lv.5 진입 후 6,750 도달) — '다음 친구 만나기' 노출 조건
export function isMaxed(pet: Pet): boolean {
  return pet.xp >= REBIRTH_XP
}

// XP 추가 → 레벨 재계산. 만렙(5,400) 이후 초과분은 버린다(환생 대기).
export function addXp(pet: Pet, amount: number): { pet: Pet; leveledUp: boolean; maxed: boolean } {
  const xp = Math.min(pet.xp + Math.max(0, amount), MAX_XP)
  const stage = stageForXp(xp)
  // maxed = 환생 가능(6,750 도달). Lv.5 진입(5,400)과는 별개
  return { pet: { ...pet, xp, stage }, leveledUp: stage > pet.stage, maxed: xp >= REBIRTH_XP }
}

// 현재 레벨 내 진행률 (패널 XP 바 표시용). Lv.5에서는 환생(6,750)까지의 진행률을 보여준다
export function xpProgress(pet: Pet): { into: number; needed: number; pct: number } {
  if (pet.stage >= MAX_LEVEL) {
    const into = pet.xp - LV5_XP
    const needed = REBIRTH_XP - LV5_XP // 1,350 (Lv.5 → 환생)
    return { into, needed, pct: Math.round((into / needed) * 100) }
  }
  const base = XP_CUMULATIVE[pet.stage - 1]
  const next = XP_CUMULATIVE[pet.stage as 1 | 2 | 3 | 4]
  const into = pet.xp - base
  const needed = next - base
  return { into, needed, pct: Math.round((into / needed) * 100) }
}

// 옛 저장 데이터(외형 문자열 배열)도 이름 있는 형태로 정규화
// 이름 저장 이전의 기록은 복원이 불가능해 종 이름으로 표기한다
const CREATURE_KO: Record<string, string> = { cat: '고양이', quokka: '쿼카', dog: '강아지' }
export function normalizeAncestors(arr: unknown): AncestorInfo[] {
  if (!Array.isArray(arr)) return []
  return arr.map((a) =>
    typeof a === 'string' ? { creature: a, name: CREATURE_KO[a] ?? a } : (a as AncestorInfo),
  )
}

export function nextCreature(current: string): string {
  const idx = CREATURES.indexOf(current as (typeof CREATURES)[number])
  return CREATURES[(idx + 1) % CREATURES.length]
}

// 만렙 환생 — 규칙서 7시트의 리셋/유지 항목 그대로:
// 리셋: 레벨→1, XP→0, 게이지→70 / 유지: 세대 +1, 평생 기록, 이름
// 먼저 살던 아이는 ancestors에 남아 미니홈에서 계속 함께 산다
export function rebirth(pet: Pet, now: number): Pet {
  return {
    ...pet,
    // 베타: 환생해도 같은 캐릭터(냥냥퐁) 유지 — 캐릭터 순환 비활성
    stage: 1,
    xp: 0,
    stats: { health: INITIAL_GAUGE, happiness: INITIAL_GAUGE, energy: INITIAL_GAUGE },
    birthday: now,
    generation: pet.generation + 1,
    ancestors: [...normalizeAncestors(pet.ancestors), { creature: pet.creature, name: pet.name }],
  }
}
