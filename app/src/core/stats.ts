import type { Stats } from './types'

export interface DecayRates {
  healthPerHour: number
  happinessPerHour: number
  energyPerHour: number
}

const HOUR_MS = 60 * 60 * 1000

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value))
}

export function decayStats(stats: Stats, elapsedMs: number, rates: DecayRates): Stats {
  const hours = elapsedMs / HOUR_MS
  return {
    health: clamp(stats.health - rates.healthPerHour * hours),
    happiness: clamp(stats.happiness - rates.happinessPerHour * hours),
    energy: clamp(stats.energy - rates.energyPerHour * hours),
  }
}

export function applyReward(stats: Stats, reward: Partial<Stats>): Stats {
  return {
    health: clamp(stats.health + (reward.health ?? 0)),
    happiness: clamp(stats.happiness + (reward.happiness ?? 0)),
    energy: clamp(stats.energy + (reward.energy ?? 0)),
  }
}
