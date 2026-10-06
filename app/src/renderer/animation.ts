import type { Pet } from '../core/types'

export type AnimationState = 'idle' | 'sleep' | 'sad'

const SAD_HAPPINESS = 40
const SLEEPY_ENERGY = 30

// 게이지 0이어도 시무룩·졸림 표현만 — 게임오버·죽음 없음(규칙서 원칙)
export function animationStateFor(pet: Pet): AnimationState {
  if (pet.stats.happiness < SAD_HAPPINESS) return 'sad'
  if (pet.stats.energy < SLEEPY_ENERGY) return 'sleep'
  return 'idle'
}
