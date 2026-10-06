# 데스크탑 펫 — 플랜 1: 코어 도메인 라이브러리 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데스크탑 펫의 모든 "두뇌"에 해당하는 순수 로직(스탯 감소·회복, 생애주기·죽음 전이, 복약/물 스케줄링)을 프레임워크와 분리된 TypeScript 라이브러리로, 테스트 우선(TDD)으로 구현한다.

**Architecture:** Electron/React에 의존하지 않는 순수 함수 모듈(`src/core/`). 모든 상태 변화는 입력→출력이 결정적인 순수 함수로 표현해 단위 테스트로 완전히 검증한다. 시간(`now`)·설정값은 항상 인자로 주입해 `Date.now()` 등 비결정 요소를 코어에서 배제한다.

**Tech Stack:** TypeScript 5, Vitest 2, Node 24 (ESM). Electron·React는 플랜 2 이후에 도입.

**참고 스펙:** `docs/superpowers/specs/2026-06-11-desktop-pet-design.md` (특히 §7 데이터 모델, §8 알림 엔진, §9 생애주기·죽음)

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `package.json` | 프로젝트 메타·스크립트·의존성 (TS + Vitest만) |
| `tsconfig.json` | TypeScript 컴파일러 설정 (strict, ESM) |
| `src/core/types.ts` | 도메인 타입(Pet, Stats, LifeStage, PetStatus) + `createNewPet` 팩토리 |
| `src/core/stats.ts` | 스탯 클램프·시간경과 감소·보상 적용 |
| `src/core/lifecycle.ts` | 건강→상태(healthy/sick/critical/dead) 전이, 성장단계, 환생 |
| `src/core/scheduler.ts` | 복약/영양제·물 알림 도래 판정(순수) |
| `src/core/*.test.ts` | 각 모듈 단위 테스트 |

각 파일은 하나의 책임만 가지며 서로 타입으로만 연결된다. 코어는 외부 I/O(파일·네트워크·시계)를 일절 갖지 않는다.

---

## Task 1: 프로젝트 부트스트랩 (TS + Vitest)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/core/smoke.test.ts` (검증용, 마지막에 삭제)

- [ ] **Step 1: `package.json` 작성**

```json
{
  "name": "desktop-pet",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `.gitignore` 작성**

```gitignore
node_modules/
dist/
out/
*.log
.DS_Store
```

- [ ] **Step 4: 의존성 설치**

Run: `npm install`
Expected: `node_modules/` 생성, 에러 없음.

- [ ] **Step 5: 스모크 테스트 작성**

`src/core/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: 테스트 실행 확인**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 7: 스모크 테스트 삭제 후 커밋**

```bash
rm src/core/smoke.test.ts
git add -A
git commit -m "chore: bootstrap TypeScript + Vitest toolchain"
```

---

## Task 2: 도메인 타입과 펫 팩토리 (`types.ts`)

**Files:**
- Create: `src/core/types.ts`
- Test: `src/core/types.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createNewPet } from './types'

describe('createNewPet', () => {
  it('새 펫은 알 단계·만점 스탯·healthy 상태로 시작한다', () => {
    const now = 1_700_000_000_000
    const pet = createNewPet('콩이', 'green', now)

    expect(pet.name).toBe('콩이')
    expect(pet.skin).toBe('green')
    expect(pet.stage).toBe('egg')
    expect(pet.stats).toEqual({ health: 100, happiness: 100, energy: 100 })
    expect(pet.status).toBe('healthy')
    expect(pet.birthday).toBe(now)
    expect(pet.lastFedAt).toBeNull()
    expect(pet.lastWateredAt).toBeNull()
    expect(pet.streakDays).toBe(0)
    expect(pet.criticalSince).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- types`
Expected: FAIL — `createNewPet` is not exported / module not found.

- [ ] **Step 3: 최소 구현 작성**

`src/core/types.ts`:
```ts
export type LifeStage = 'egg' | 'baby' | 'adult'
export type PetStatus = 'healthy' | 'sick' | 'critical' | 'dead'

export interface Stats {
  health: number // 0-100
  happiness: number // 0-100
  energy: number // 0-100
}

export interface Pet {
  name: string
  skin: string
  stage: LifeStage
  stats: Stats
  status: PetStatus
  birthday: number // epoch ms
  lastFedAt: number | null
  lastWateredAt: number | null
  streakDays: number
  criticalSince: number | null // critical 진입 시각, 그 외 null
}

export function createNewPet(name: string, skin: string, now: number): Pet {
  return {
    name,
    skin,
    stage: 'egg',
    stats: { health: 100, happiness: 100, energy: 100 },
    status: 'healthy',
    birthday: now,
    lastFedAt: null,
    lastWateredAt: null,
    streakDays: 0,
    criticalSince: null,
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- types`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/core/types.ts src/core/types.test.ts
git commit -m "feat(core): add domain types and createNewPet factory"
```

---

## Task 3: 스탯 로직 (`stats.ts`)

`clamp`(0-100 범위 고정), `decayStats`(경과시간만큼 감소), `applyReward`(습관 이행 시 회복).

**Files:**
- Create: `src/core/stats.ts`
- Test: `src/core/stats.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/stats.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { clamp, decayStats, applyReward, type DecayRates } from './stats'
import type { Stats } from './types'

const HOUR = 60 * 60 * 1000
const rates: DecayRates = { healthPerHour: 2, happinessPerHour: 4, energyPerHour: 6 }

describe('clamp', () => {
  it('범위 안의 값은 그대로 둔다', () => {
    expect(clamp(50)).toBe(50)
  })
  it('하한·상한을 벗어나면 잘라낸다', () => {
    expect(clamp(-10)).toBe(0)
    expect(clamp(150)).toBe(100)
  })
})

describe('decayStats', () => {
  it('경과 시간(시간 단위)에 비례해 각 스탯을 감소시킨다', () => {
    const stats: Stats = { health: 100, happiness: 100, energy: 100 }
    const result = decayStats(stats, 2 * HOUR, rates)
    expect(result).toEqual({ health: 96, happiness: 92, energy: 88 })
  })
  it('0 미만으로는 내려가지 않는다', () => {
    const stats: Stats = { health: 1, happiness: 1, energy: 1 }
    const result = decayStats(stats, 100 * HOUR, rates)
    expect(result).toEqual({ health: 0, happiness: 0, energy: 0 })
  })
})

describe('applyReward', () => {
  it('지정한 스탯만 더하고 100을 넘지 않는다', () => {
    const stats: Stats = { health: 90, happiness: 50, energy: 50 }
    const result = applyReward(stats, { health: 20, happiness: 10 })
    expect(result).toEqual({ health: 100, happiness: 60, energy: 50 })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- stats`
Expected: FAIL — module not found.

- [ ] **Step 3: 최소 구현 작성**

`src/core/stats.ts`:
```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- stats`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/core/stats.ts src/core/stats.test.ts
git commit -m "feat(core): add stat clamp, decay, and reward logic"
```

---

## Task 4: 생애주기·죽음·환생 (`lifecycle.ts`)

`evaluateStatus`(건강 수치 + critical 지속시간 → 상태), `advanceStage`(스트릭 → 성장단계), `revive`(죽은 펫 → 새 알).

> 설계 §9: 방치가 길어지면 아픔→위독→죽음으로 단계 악화. `evaluateStatus`는 **죽지 않은 펫**에만 호출한다(죽은 펫은 호출자가 환생 전까지 상태를 다시 계산하지 않는다).

**Files:**
- Create: `src/core/lifecycle.ts`
- Test: `src/core/lifecycle.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/lifecycle.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  evaluateStatus,
  advanceStage,
  revive,
  type StatusThresholds,
  type StageRules,
} from './lifecycle'
import { createNewPet } from './types'

const HOUR = 60 * 60 * 1000
const thresholds: StatusThresholds = {
  sickAt: 30,
  criticalAt: 10,
  deathAfterMs: 24 * HOUR,
}
const stageRules: StageRules = { babyAtStreak: 3, adultAtStreak: 7 }
const T = 1_700_000_000_000

describe('evaluateStatus', () => {
  it('건강이 충분하면 healthy, criticalSince는 비운다', () => {
    expect(evaluateStatus(50, null, T, thresholds)).toEqual({
      status: 'healthy',
      criticalSince: null,
    })
  })
  it('sickAt 이하면 sick', () => {
    expect(evaluateStatus(25, null, T, thresholds)).toEqual({
      status: 'sick',
      criticalSince: null,
    })
  })
  it('criticalAt 이하면 critical이고 진입 시각을 기록한다', () => {
    expect(evaluateStatus(5, null, T, thresholds)).toEqual({
      status: 'critical',
      criticalSince: T,
    })
  })
  it('이미 critical이면 진입 시각을 유지한다', () => {
    const since = T - 5 * HOUR
    expect(evaluateStatus(5, since, T, thresholds)).toEqual({
      status: 'critical',
      criticalSince: since,
    })
  })
  it('critical이 deathAfterMs 이상 지속되면 dead', () => {
    const since = T - 25 * HOUR
    expect(evaluateStatus(0, since, T, thresholds)).toEqual({
      status: 'dead',
      criticalSince: since,
    })
  })
  it('건강이 회복되면 criticalSince를 초기화한다', () => {
    const since = T - 5 * HOUR
    expect(evaluateStatus(80, since, T, thresholds)).toEqual({
      status: 'healthy',
      criticalSince: null,
    })
  })
})

describe('advanceStage', () => {
  it('스트릭에 따라 egg→baby→adult', () => {
    expect(advanceStage(0, stageRules)).toBe('egg')
    expect(advanceStage(3, stageRules)).toBe('baby')
    expect(advanceStage(7, stageRules)).toBe('adult')
  })
})

describe('revive', () => {
  it('죽은 펫을 이름·스킨만 유지한 새 알로 되살린다', () => {
    const dead = {
      ...createNewPet('콩이', 'green', T - 100 * HOUR),
      stage: 'adult' as const,
      status: 'dead' as const,
      stats: { health: 0, happiness: 0, energy: 0 },
      streakDays: 9,
      criticalSince: T - 50 * HOUR,
    }
    const reborn = revive(dead, T)
    expect(reborn.name).toBe('콩이')
    expect(reborn.skin).toBe('green')
    expect(reborn.stage).toBe('egg')
    expect(reborn.status).toBe('healthy')
    expect(reborn.stats).toEqual({ health: 100, happiness: 100, energy: 100 })
    expect(reborn.birthday).toBe(T)
    expect(reborn.streakDays).toBe(0)
    expect(reborn.criticalSince).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- lifecycle`
Expected: FAIL — module not found.

- [ ] **Step 3: 최소 구현 작성**

`src/core/lifecycle.ts`:
```ts
import type { LifeStage, PetStatus, Pet } from './types'

export interface StatusThresholds {
  sickAt: number // health <= sickAt (그리고 > criticalAt) → sick
  criticalAt: number // health <= criticalAt → critical
  deathAfterMs: number // critical 지속이 이 시간 이상이면 dead
}

export interface StageRules {
  babyAtStreak: number
  adultAtStreak: number
}

export interface StatusResult {
  status: PetStatus
  criticalSince: number | null
}

export function evaluateStatus(
  health: number,
  criticalSince: number | null,
  now: number,
  thresholds: StatusThresholds,
): StatusResult {
  if (health <= thresholds.criticalAt) {
    const since = criticalSince ?? now
    if (now - since >= thresholds.deathAfterMs) {
      return { status: 'dead', criticalSince: since }
    }
    return { status: 'critical', criticalSince: since }
  }
  if (health <= thresholds.sickAt) {
    return { status: 'sick', criticalSince: null }
  }
  return { status: 'healthy', criticalSince: null }
}

export function advanceStage(streakDays: number, rules: StageRules): LifeStage {
  if (streakDays >= rules.adultAtStreak) return 'adult'
  if (streakDays >= rules.babyAtStreak) return 'baby'
  return 'egg'
}

export function revive(pet: Pet, now: number): Pet {
  return {
    ...pet,
    stage: 'egg',
    stats: { health: 100, happiness: 100, energy: 100 },
    status: 'healthy',
    birthday: now,
    lastFedAt: null,
    lastWateredAt: null,
    streakDays: 0,
    criticalSince: null,
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- lifecycle`
Expected: PASS (8 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/core/lifecycle.ts src/core/lifecycle.test.ts
git commit -m "feat(core): add status transitions, growth stages, and revive"
```

---

## Task 5: 알림 스케줄러 (`scheduler.ts`)

복약/영양제: 오늘 예정 시각 계산 + 도래 판정. 물: 남은 컵 수 + 간격 기반 도래 판정. 보조(스트레칭·눈·수면)는 물과 동일한 "간격 기반" 패턴이라 플랜 3에서 `isWaterDue`를 재사용한다.

> 시간 계산은 모두 **로컬 자정(`dayStart`)** 을 인자로 받는다. `startOfLocalDay`로 임의 시각에서 로컬 자정을 구한다. 테스트는 `new Date(년,월,일,...)`(로컬 기준)로 입력·기대값을 함께 만들어 타임존에 무관하게 결정적이다.

**Files:**
- Create: `src/core/scheduler.ts`
- Test: `src/core/scheduler.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/scheduler.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  startOfLocalDay,
  scheduledTimesForDay,
  isMedicationDue,
  cupsRemaining,
  isWaterDue,
  type MedSchedule,
  type WaterConfig,
} from './scheduler'

const MIN = 60 * 1000
// 2026-06-11은 목요일(getDay() === 4)
const dayStart = new Date(2026, 5, 11, 0, 0, 0, 0).getTime()
const at = (h: number, m: number) => new Date(2026, 5, 11, h, m, 0, 0).getTime()

const vitaminD: MedSchedule = {
  id: 'vd',
  name: '비타민D',
  isSupplement: true,
  times: ['09:00', '21:00'],
  days: [], // 매일
}

describe('startOfLocalDay', () => {
  it('하루 중 임의 시각을 그날 로컬 자정으로 내린다', () => {
    expect(startOfLocalDay(at(14, 37))).toBe(dayStart)
  })
})

describe('scheduledTimesForDay', () => {
  it('매일 복용이면 모든 시각을 그날 epoch로 변환한다', () => {
    expect(scheduledTimesForDay(vitaminD, dayStart)).toEqual([at(9, 0), at(21, 0)])
  })
  it('해당 요일이 아니면 빈 배열', () => {
    const monOnly: MedSchedule = { ...vitaminD, days: [1] } // 월요일만
    expect(scheduledTimesForDay(monOnly, dayStart)).toEqual([])
  })
})

describe('isMedicationDue', () => {
  it('예정 시각이 아직 안 됐으면 due 아님', () => {
    expect(isMedicationDue(vitaminD, at(8, 30), null, dayStart)).toBe(false)
  })
  it('예정 시각을 지났고 복용 기록이 없으면 due', () => {
    expect(isMedicationDue(vitaminD, at(9, 5), null, dayStart)).toBe(true)
  })
  it('해당 예정 시각 이후에 이미 복용했으면 due 아님', () => {
    expect(isMedicationDue(vitaminD, at(9, 30), at(9, 10), dayStart)).toBe(false)
  })
  it('다음 예정 시각이 지나면 다시 due', () => {
    // 09:00분을 09:10에 복용했지만 21:00이 지난 21:05엔 다시 due
    expect(isMedicationDue(vitaminD, at(21, 5), at(9, 10), dayStart)).toBe(true)
  })
})

describe('water', () => {
  const config: WaterConfig = { dailyTargetCups: 8, intervalMinutes: 90 }

  it('cupsRemaining은 목표에서 마신 컵을 뺀다(음수 없음)', () => {
    expect(cupsRemaining(config, 3)).toBe(5)
    expect(cupsRemaining(config, 10)).toBe(0)
  })
  it('오늘 목표를 채웠으면 due 아님', () => {
    expect(isWaterDue(config, at(15, 0), at(14, 0), 8)).toBe(false)
  })
  it('아직 한 번도 안 마셨으면 due', () => {
    expect(isWaterDue(config, at(9, 0), null, 0)).toBe(true)
  })
  it('마지막 섭취 후 간격이 지났으면 due', () => {
    expect(isWaterDue(config, at(11, 0), at(9, 0), 1)).toBe(true)
  })
  it('간격이 아직 안 지났으면 due 아님', () => {
    expect(isWaterDue(config, at(9, 0) + 30 * MIN, at(9, 0), 1)).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- scheduler`
Expected: FAIL — module not found.

- [ ] **Step 3: 최소 구현 작성**

`src/core/scheduler.ts`:
```ts
export interface MedSchedule {
  id: string
  name: string
  isSupplement: boolean
  times: string[] // "HH:MM" 24시간 표기
  days: number[] // 0=일 ~ 6=토, 빈 배열이면 매일
  dose?: string
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- scheduler`
Expected: PASS (12 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/core/scheduler.ts src/core/scheduler.test.ts
git commit -m "feat(core): add medication and water reminder scheduling"
```

---

## Task 6: 전체 검증 & 플랜 마무리

- [ ] **Step 1: 전체 테스트 실행**

Run: `npm test`
Expected: 4개 테스트 파일, 모두 PASS (총 26개 테스트: types 1 + stats 5 + lifecycle 8 + scheduler 12). 실제 카운트가 다르면 누락된 케이스를 점검한다.

- [ ] **Step 2: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 0.

- [ ] **Step 3: 최종 커밋(이미 단계별로 커밋되어 있으면 생략)**

```bash
git status   # 깔끔해야 함
```

---

## 다음 플랜 예고 (플랜 2에서 코어를 어떻게 쓰는가)

플랜 2(화면 위 펫)는 이 코어를 다음처럼 소비한다. 코어 API를 바꾸지 말고 그대로 사용:
- 펫 1마리 상태를 `Pet`으로 보유, 일정 간격으로 `decayStats` → `evaluateStatus`로 상태 갱신.
- `pet.status`/`pet.stage`를 애니메이션 상태(가만히/슬픔/아픔/위독)에 매핑.
- 알림 엔진(플랜 3)은 `isMedicationDue`/`isWaterDue`로 도래를 판정하고, 사용자가 확인하면 `applyReward`로 스탯 회복.
- `revive`는 추모 후 새 알 시작(플랜 4)에 사용.
