// 돌봄 행동 3종 — 밥주기·쓰다듬기·산책 (규칙서 4.돌봄 행동)
// 횟수 제한 없음(상한 초과분은 Clamp로 버림) · 미이행은 자연 감소로만 반영.
import type { Pet } from './types'
import { applyReward } from './stats'
import { addXp } from './progression'
import { CARE_FEED, CARE_PAT, CARE_WALK } from './config'

export type CareKind = 'feed' | 'pat' | 'walk'

const REWARDS = { feed: CARE_FEED, pat: CARE_PAT, walk: CARE_WALK } as const

// grantXp=false면 게이지·누적은 그대로 올리되 XP만 +0 (파트별 하루 3회 상한 초과 시)
export function applyCare(
  pet: Pet,
  kind: CareKind,
  grantXp = true,
): { pet: Pet; leveledUp: boolean; maxed: boolean } {
  const r = REWARDS[kind]
  const cared: Pet = {
    ...pet,
    stats: applyReward(pet.stats, { health: r.health, happiness: r.happiness, energy: r.energy }),
    lifetime: { ...pet.lifetime, care: pet.lifetime.care + 1 },
  }
  return addXp(cared, grantXp ? r.xp : 0)
}
