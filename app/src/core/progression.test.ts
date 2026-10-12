import { describe, expect, it } from 'vitest'
import { createNewPet } from './types'
import { addXp, isMaxed, rebirth, stageForXp, xpProgress, MAX_XP } from './progression'

describe('레벨·XP (규칙서 6시트)', () => {
  it('누적 XP 임계 — Lv.2=300, Lv.3=1,350, Lv.4=3,150, Lv.5=5,400 (기획서 v7 6시트)', () => {
    expect(stageForXp(0)).toBe(1)
    expect(stageForXp(299)).toBe(1)
    expect(stageForXp(300)).toBe(2)
    expect(stageForXp(1350)).toBe(3)
    expect(stageForXp(3150)).toBe(4)
    expect(stageForXp(5400)).toBe(5)
  })

  it('addXp — 레벨업 감지, 만렙 초과분은 버림', () => {
    const pet = createNewPet('퐁이', 'cat', 0)
    const up = addXp(pet, 300)
    expect(up.leveledUp).toBe(true)
    expect(up.pet.stage).toBe(2)
    const maxed = addXp(pet, MAX_XP + 999)
    expect(maxed.pet.xp).toBe(MAX_XP)
    expect(maxed.maxed).toBe(true)
    expect(isMaxed(maxed.pet)).toBe(true)
  })

  it('xpProgress — 현재 레벨 내 진행률', () => {
    const pet = { ...createNewPet('퐁이', 'cat', 0), xp: 800, stage: 2 as const }
    const p = xpProgress(pet)
    expect(p.into).toBe(500) // 800 − 300(Lv.2 누적)
    expect(p.needed).toBe(1050) // 1,350 − 300
  })
})

describe('만렙 환생 (규칙서 7시트)', () => {
  it('리셋: 레벨1·XP0·게이지70 / 유지: 세대+1·평생기록·이름 / 환생 시 순서상 다음 캐릭터로', () => {
    const pet = {
      ...createNewPet('퐁이', 'cat', 0, ['cat', 'dragon']),
      xp: MAX_XP,
      stage: 5 as const,
      stats: { health: 40, happiness: 90, energy: 10 },
      lifetime: { care: 12, alarms: 34, reliefs: 5, chats: 7 },
    }
    const born = rebirth(pet, 1000)
    expect(born.stage).toBe(1)
    expect(born.xp).toBe(0)
    expect(born.stats).toEqual({ health: 70, happiness: 70, energy: 70 })
    expect(born.generation).toBe(2)
    expect(born.lifetime).toEqual({ care: 12, alarms: 34, reliefs: 5, chats: 7 })
    expect(born.name).toBe('퐁이')
    expect(born.creature).toBe('dragon') // cat → 다음 캐릭터(dragon)
    expect(born.ancestors).toEqual([{ creature: 'cat', name: '퐁이' }])
  })

  it('환생 시 순서배열대로 cat↔dragon 전환 · 세대 증가(베타 2종 왕복)', () => {
    let pet = createNewPet('퐁이', 'cat', 0, ['cat', 'dragon'])
    expect(pet.creature).toBe('cat')
    pet = rebirth(pet, 0)
    expect(pet.creature).toBe('dragon')
    expect(pet.generation).toBe(2)
    pet = rebirth(pet, 0)
    expect(pet.creature).toBe('cat')
    pet = rebirth(pet, 0)
    expect(pet.creature).toBe('dragon')
    expect(pet.generation).toBe(4)
  })

  it('첫 등장이 dragon이면 환생 시 cat으로', () => {
    let pet = createNewPet('퐁이', 'dragon', 0, ['dragon', 'cat'])
    pet = rebirth(pet, 0)
    expect(pet.creature).toBe('cat')
  })
})
