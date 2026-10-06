# 데스크탑 펫 — 플랜 2: 화면 위 펫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** macOS 바탕화면에 펫이 떠서, 플랜 1의 코어 상태(스탯 감소·상태 전이)를 따라 살아 움직이고, 드래그로 옮길 수 있고, 우클릭/길게누르기로 컨텍스트 메뉴가 뜨는 투명 오버레이 앱을 만든다. (건강기능 UI는 플랜 3 — 여기서는 메뉴의 "먹이주기" 데모로 보상 배선만 증명한다.)

**Architecture:** Electron(메인=투명 오버레이 창·IPC·저장, 프리로드=contextBridge, 렌더러=React 펫). 렌더러의 게임 로직(틱·애니메이션 매핑·위치 클램프)은 플랜 1처럼 순수 함수로 분리해 Vitest로 TDD한다. 창/오버레이/드래그/메뉴 같은 Electron 통합은 수동·시각 검증한다.

**Tech Stack:** Electron + electron-vite + React 18 + TypeScript, electron-store(영속화), Vitest(순수 로직). 플랜 1의 `src/core/*`를 그대로 소비한다.

**참고 스펙:** `docs/superpowers/specs/2026-06-11-desktop-pet-design.md` (§5 아키텍처, §6 상호작용, §9 생애주기). 플랜 1 결과물: `src/core/{types,stats,lifecycle,scheduler}.ts`.

> **아트 결정:** 펫 외형은 단순 플레이스홀더(CSS 캐릭터)로 시작한다. 실제 아트는 이후 전용 디자인 단계에서 확정한다. 이 플랜은 메커니즘이 목표다.

---

## File Structure

| 파일 | 책임 | 신규/수정 |
| --- | --- | --- |
| `src/core/config.ts` | 게임 튜닝 상수(감소율·임계치·성장규칙·틱간격) | 신규(순수) |
| `src/renderer/petEngine.ts` | 순수 틱: `tick(pet, lastTickAt, now, config)` → 새 Pet | 신규(순수, TDD) |
| `src/renderer/animation.ts` | 순수 매핑: `animationStateFor(pet)` → 애니메이션 상태 | 신규(순수, TDD) |
| `src/renderer/geometry.ts` | 순수 기하: 화면경계 클램프·점-사각형 충돌 | 신규(순수, TDD) |
| `electron.vite.config.ts` | electron-vite(main/preload/renderer) 설정 | 신규 |
| `package.json` | Electron 의존성·스크립트 추가 | 수정 |
| `tsconfig.json` | DOM lib·react-jsx 추가 | 수정 |
| `src/main/index.ts` | 앱 수명주기·투명 오버레이 창·IPC·컨텍스트 메뉴 | 신규 |
| `src/main/store.ts` | electron-store 영속화 래퍼 | 신규 |
| `src/preload/index.ts` | contextBridge `window.petApi` | 신규 |
| `src/preload/index.d.ts` | `window.petApi` 타입 선언 | 신규 |
| `src/renderer/index.html` | 렌더러 진입 HTML | 신규 |
| `src/renderer/main.tsx` | React 마운트 | 신규 |
| `src/renderer/App.tsx` | 오버레이 루트: 마우스추적·클릭통과 토글·드래그·메뉴 | 신규 |
| `src/renderer/Pet.tsx` | 펫 시각 + 애니메이션 | 신규 |
| `src/renderer/pet.css` | 플레이스홀더 펫 스타일·키프레임 | 신규 |

순수 모듈(`config/petEngine/animation/geometry`)은 Electron 없이 테스트된다. 통합 파일(main/preload/renderer 컴포넌트)은 수동 검증한다.

---

## Task 1: 게임 설정 + 펫 엔진 틱 (`config.ts`, `petEngine.ts`)

`tick`은 펫 1마리의 시간경과를 한 번에 적용하는 순수 함수: 죽지 않았으면 경과시간만큼 스탯 감소 → 상태 재평가 → 성장단계 갱신.

**Files:**
- Create: `src/core/config.ts`
- Create: `src/renderer/petEngine.ts`
- Test: `src/renderer/petEngine.test.ts`

- [ ] **Step 1: 설정 상수 작성** — `src/core/config.ts`:
```ts
import type { DecayRates } from './stats'
import type { StatusThresholds, StageRules } from './lifecycle'

export const DEFAULT_DECAY_RATES: DecayRates = {
  healthPerHour: 1.5,
  happinessPerHour: 2.5,
  energyPerHour: 2,
}

export const DEFAULT_THRESHOLDS: StatusThresholds = {
  sickAt: 30,
  criticalAt: 10,
  deathAfterMs: 48 * 60 * 60 * 1000, // 48시간 지속 위독 → 죽음
}

export const DEFAULT_STAGE_RULES: StageRules = {
  babyAtStreak: 3,
  adultAtStreak: 7,
}

export const TICK_INTERVAL_MS = 60 * 1000 // 엔진은 1분마다 틱
```

- [ ] **Step 2: 실패하는 테스트 작성** — `src/renderer/petEngine.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { tick, type EngineConfig } from './petEngine'
import { createNewPet, type Pet } from '../core/types'

const HOUR = 60 * 60 * 1000
const T = 1_700_000_000_000
const config: EngineConfig = {
  decayRates: { healthPerHour: 2, happinessPerHour: 4, energyPerHour: 6 },
  thresholds: { sickAt: 30, criticalAt: 10, deathAfterMs: 24 * HOUR },
  stageRules: { babyAtStreak: 3, adultAtStreak: 7 },
}

describe('tick', () => {
  it('경과 시간만큼 스탯을 감소시킨다', () => {
    const pet = createNewPet('콩이', 'green', T)
    const next = tick(pet, T, T + 2 * HOUR, config)
    expect(next.stats).toEqual({ health: 96, happiness: 92, energy: 88 })
  })

  it('건강이 임계치 아래로 떨어지면 상태를 갱신한다', () => {
    const pet: Pet = { ...createNewPet('콩이', 'green', T), stats: { health: 12, happiness: 50, energy: 50 } }
    // 2시간 경과 → health 12 - 2*2 = 8 (<=10) → critical, criticalSince 기록
    const next = tick(pet, T, T + 2 * HOUR, config)
    expect(next.stats.health).toBe(8)
    expect(next.status).toBe('critical')
    expect(next.criticalSince).toBe(T + 2 * HOUR)
  })

  it('죽은 펫은 변하지 않는다', () => {
    const dead: Pet = { ...createNewPet('콩이', 'green', T), status: 'dead', stats: { health: 0, happiness: 0, energy: 0 } }
    const next = tick(dead, T, T + 10 * HOUR, config)
    expect(next).toEqual(dead)
  })

  it('스트릭에 따라 성장단계를 갱신한다', () => {
    const pet: Pet = { ...createNewPet('콩이', 'green', T), streakDays: 3 }
    const next = tick(pet, T, T + 1 * HOUR, config)
    expect(next.stage).toBe('baby')
  })

  it('과거가 아닌 시각(음수 경과)에는 스탯을 깎지 않는다', () => {
    const pet = createNewPet('콩이', 'green', T)
    const next = tick(pet, T, T - 5 * HOUR, config)
    expect(next.stats).toEqual({ health: 100, happiness: 100, energy: 100 })
  })
})
```

- [ ] **Step 3: 테스트 실패 확인** — Run: `npm test -- petEngine`. Expected: FAIL (module missing).

- [ ] **Step 4: 최소 구현 작성** — `src/renderer/petEngine.ts`:
```ts
import type { Pet } from '../core/types'
import { decayStats, type DecayRates } from '../core/stats'
import {
  evaluateStatus,
  advanceStage,
  type StatusThresholds,
  type StageRules,
} from '../core/lifecycle'

export interface EngineConfig {
  decayRates: DecayRates
  thresholds: StatusThresholds
  stageRules: StageRules
}

export function tick(pet: Pet, lastTickAt: number, now: number, config: EngineConfig): Pet {
  if (pet.status === 'dead') return pet
  const elapsed = Math.max(0, now - lastTickAt)
  const stats = decayStats(pet.stats, elapsed, config.decayRates)
  const { status, criticalSince } = evaluateStatus(
    stats.health,
    pet.criticalSince,
    now,
    config.thresholds,
  )
  const stage = advanceStage(pet.streakDays, config.stageRules)
  return { ...pet, stats, status, criticalSince, stage }
}
```

- [ ] **Step 5: 테스트 통과 확인** — Run: `npm test -- petEngine`. Expected: PASS (5 tests).

- [ ] **Step 6: 커밋**
```bash
git add src/core/config.ts src/renderer/petEngine.ts src/renderer/petEngine.test.ts
git commit -m "feat(engine): add tuning config and pure pet tick"
```

---

## Task 2: 애니메이션 상태 매핑 (`animation.ts`)

펫 상태/스탯 → 시각 애니메이션 상태. 우선순위: dead > critical > sick > sad(행복 낮음) > sleep(기력 낮음) > idle. (배회 'walk'는 순수 매핑이 아니라 렌더러 이동 로직이 다루므로 여기 없음.)

**Files:**
- Create: `src/renderer/animation.ts`
- Test: `src/renderer/animation.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/animation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { animationStateFor } from './animation'
import { createNewPet, type Pet } from '../core/types'

const T = 1_700_000_000_000
const base = (over: Partial<Pet>): Pet => ({ ...createNewPet('콩이', 'green', T), ...over })

describe('animationStateFor', () => {
  it('건강한 기본 상태는 idle', () => {
    expect(animationStateFor(base({}))).toBe('idle')
  })
  it('죽으면 dead가 최우선', () => {
    expect(animationStateFor(base({ status: 'dead', stats: { health: 0, happiness: 0, energy: 0 } }))).toBe('dead')
  })
  it('위독은 critical', () => {
    expect(animationStateFor(base({ status: 'critical' }))).toBe('critical')
  })
  it('아프면 sick', () => {
    expect(animationStateFor(base({ status: 'sick' }))).toBe('sick')
  })
  it('행복이 낮으면 sad', () => {
    expect(animationStateFor(base({ stats: { health: 80, happiness: 30, energy: 80 } }))).toBe('sad')
  })
  it('기력이 낮으면 sleep', () => {
    expect(animationStateFor(base({ stats: { health: 80, happiness: 80, energy: 20 } }))).toBe('sleep')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npm test -- animation`. Expected: FAIL.

- [ ] **Step 3: 최소 구현 작성** — `src/renderer/animation.ts`:
```ts
import type { Pet } from '../core/types'

export type AnimationState = 'idle' | 'sleep' | 'sad' | 'sick' | 'critical' | 'dead'

const SAD_HAPPINESS = 40
const SLEEPY_ENERGY = 30

export function animationStateFor(pet: Pet): AnimationState {
  if (pet.status === 'dead') return 'dead'
  if (pet.status === 'critical') return 'critical'
  if (pet.status === 'sick') return 'sick'
  if (pet.stats.happiness < SAD_HAPPINESS) return 'sad'
  if (pet.stats.energy < SLEEPY_ENERGY) return 'sleep'
  return 'idle'
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test -- animation`. Expected: PASS (6 tests).

- [ ] **Step 5: 커밋**
```bash
git add src/renderer/animation.ts src/renderer/animation.test.ts
git commit -m "feat(renderer): map pet state to animation state"
```

---

## Task 3: 기하 유틸 (`geometry.ts`)

화면 경계 안으로 위치 클램프 + 점이 펫 사각형 안인지 판정(클릭통과 토글·드래그에 사용).

**Files:**
- Create: `src/renderer/geometry.ts`
- Test: `src/renderer/geometry.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/geometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { clampToBounds, isPointInRect, type Point, type Size, type Bounds } from './geometry'

const size: Size = { width: 100, height: 100 }
const bounds: Bounds = { width: 1000, height: 800 }

describe('clampToBounds', () => {
  it('범위 안의 위치는 그대로', () => {
    expect(clampToBounds({ x: 200, y: 200 }, size, bounds)).toEqual({ x: 200, y: 200 })
  })
  it('왼쪽·위로 넘으면 0으로', () => {
    expect(clampToBounds({ x: -50, y: -20 }, size, bounds)).toEqual({ x: 0, y: 0 })
  })
  it('오른쪽·아래로 넘으면 경계-크기로', () => {
    expect(clampToBounds({ x: 9999, y: 9999 }, size, bounds)).toEqual({ x: 900, y: 700 })
  })
})

describe('isPointInRect', () => {
  const rectPos: Point = { x: 100, y: 100 }
  it('사각형 안의 점은 true', () => {
    expect(isPointInRect({ x: 150, y: 150 }, rectPos, size)).toBe(true)
  })
  it('경계 위의 점은 true', () => {
    expect(isPointInRect({ x: 100, y: 200 }, rectPos, size)).toBe(true)
  })
  it('바깥 점은 false', () => {
    expect(isPointInRect({ x: 50, y: 150 }, rectPos, size)).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npm test -- geometry`. Expected: FAIL.

- [ ] **Step 3: 최소 구현 작성** — `src/renderer/geometry.ts`:
```ts
export interface Point {
  x: number
  y: number
}
export interface Size {
  width: number
  height: number
}
export interface Bounds {
  width: number
  height: number
}

export function clampToBounds(pos: Point, size: Size, bounds: Bounds): Point {
  return {
    x: Math.max(0, Math.min(pos.x, bounds.width - size.width)),
    y: Math.max(0, Math.min(pos.y, bounds.height - size.height)),
  }
}

export function isPointInRect(point: Point, rectPos: Point, size: Size): boolean {
  return (
    point.x >= rectPos.x &&
    point.x <= rectPos.x + size.width &&
    point.y >= rectPos.y &&
    point.y <= rectPos.y + size.height
  )
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test -- geometry`. Expected: PASS (6 tests).

- [ ] **Step 5: 커밋**
```bash
git add src/renderer/geometry.ts src/renderer/geometry.test.ts
git commit -m "feat(renderer): add bounds clamp and hit-test geometry"
```

---

## Task 4: Electron 스캐폴드 (보이는 펫 플레이스홀더)

electron-vite + React 도입, 일반(아직 불투명) 창에 펫 플레이스홀더를 띄워 빌드·실행 파이프라인을 검증한다. 투명·오버레이는 Task 5에서.

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `electron.vite.config.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/preload/index.d.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/Pet.tsx`
- Create: `src/renderer/pet.css`

- [ ] **Step 1: 의존성 설치**
```bash
npm install electron electron-store
npm install -D electron-vite @vitejs/plugin-react react react-dom @types/react @types/react-dom @types/node
```
Expected: 설치 성공(Electron 바이너리 다운로드 포함). 시간이 걸릴 수 있음.

- [ ] **Step 2: `package.json` 수정** — `main` 필드와 스크립트를 추가/병합한다. 기존 `test`/`typecheck`는 유지. 최종 형태:
```json
{
  "name": "desktop-pet",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```
> 주의: `dependencies`/`devDependencies`는 Step 1 설치로 채워져 있으니 덮어쓰지 말고 위 필드만 병합한다.

- [ ] **Step 3: `tsconfig.json` 수정** — DOM lib·react-jsx 추가. 최종:
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
    "forceConsistentCasingInFileNames": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: `electron.vite.config.ts` 작성**
```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
    plugins: [react()],
  },
})
```

- [ ] **Step 5: 메인 프로세스 작성** — `src/main/index.ts` (Task 4 버전: 일반 창):
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 400,
    height: 400,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 6: 프리로드 작성** — `src/preload/index.ts` (Task 4: 빈 브리지, Task 5+에서 확장):
```ts
import { contextBridge } from 'electron'

const petApi = {}

contextBridge.exposeInMainWorld('petApi', petApi)

export type PetApi = typeof petApi
```
`src/preload/index.d.ts`:
```ts
import type { PetApi } from './index'

declare global {
  interface Window {
    petApi: PetApi
  }
}
```

- [ ] **Step 7: 렌더러 작성**

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Desktop Pet</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx`:
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './pet.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

`src/renderer/Pet.tsx`:
```tsx
import type { AnimationState } from './animation'

interface PetProps {
  animation: AnimationState
}

export default function Pet({ animation }: PetProps) {
  return (
    <div className={`pet pet--${animation}`} data-testid="pet">
      <div className="pet__body">
        <div className="pet__eye pet__eye--left" />
        <div className="pet__eye pet__eye--right" />
      </div>
    </div>
  )
}
```

`src/renderer/App.tsx` (Task 4: 정적 펫):
```tsx
import Pet from './Pet'

export default function App() {
  return (
    <div className="overlay">
      <Pet animation="idle" />
    </div>
  )
}
```

`src/renderer/pet.css`:
```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: transparent; overflow: hidden; user-select: none; }

.overlay { width: 100vw; height: 100vh; position: relative; }

.pet {
  position: absolute;
  width: 96px;
  height: 96px;
  left: 0;
  top: 0;
  cursor: grab;
}
.pet__body {
  width: 100%;
  height: 100%;
  background: #2b2b2b;
  border-radius: 48% 48% 46% 46%;
  position: relative;
  animation: bob 2.4s ease-in-out infinite;
}
.pet__eye {
  position: absolute;
  top: 34px;
  width: 12px;
  height: 12px;
  background: #fff;
  border-radius: 50%;
}
.pet__eye--left { left: 26px; }
.pet__eye--right { right: 26px; }

.pet--sleep .pet__body { animation: none; opacity: 0.85; }
.pet--sad .pet__body { filter: grayscale(0.4); }
.pet--sick .pet__body { background: #4a5240; }
.pet--critical .pet__body { background: #5c3b3b; animation: shiver 0.3s linear infinite; }
.pet--dead .pet__body { background: #888; filter: grayscale(1); animation: none; }
.pet--dead .pet__eye { background: #444; }

@keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes shiver { 0%,100% { transform: translateX(-1px); } 50% { transform: translateX(1px); } }
```

- [ ] **Step 8: 빌드·타입·실행 검증**

Run: `npm run typecheck` → Expected: 에러 0.
Run: `npm test` → Expected: 기존 순수 테스트 모두 PASS(플랜1 26 + petEngine 5 + animation 6 + geometry 6 = 43).
Run: `npm run dev` → Expected: 400×400 창이 뜨고 어두운 동글 펫이 위아래로 까딱거린다. (수동 시각 확인. 확인 후 창 닫기.)

- [ ] **Step 9: 커밋**
```bash
git add -A
git commit -m "feat(app): scaffold electron-vite + react with placeholder pet"
```

---

## Task 5: 투명 오버레이 창 + 영속화 + 틱 루프

창을 화면 전체를 덮는 투명·프레임없음·항상위·클릭통과로 바꾸고, 펫 상태를 저장/복원하며, 1분 틱으로 살아 움직이게 한다.

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/store.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: 영속화 래퍼 작성** — `src/main/store.ts`:
```ts
import Store from 'electron-store'
import type { Pet } from '../core/types'

export interface PersistedState {
  pet: Pet
  position: { x: number; y: number }
  lastTickAt: number
}

const store = new Store<{ state: PersistedState | null }>({ defaults: { state: null } })

export function loadState(): PersistedState | null {
  return store.get('state')
}

export function saveState(state: PersistedState): void {
  store.set('state', state)
}
```

- [ ] **Step 2: 메인 프로세스 수정** — `src/main/index.ts` (투명 오버레이 + IPC):
```ts
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { loadState, saveState, type PersistedState } from './store'

let win: BrowserWindow | null = null

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  win = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // 기본은 클릭 통과: 펫 위에 있을 때만 렌더러가 false로 토글한다.
  win.setIgnoreMouseEvents(true, { forward: true })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('pet:load', (): PersistedState | null => loadState())
ipcMain.on('pet:save', (_e, state: PersistedState) => saveState(state))
ipcMain.on('pet:setClickThrough', (_e, enabled: boolean) => {
  win?.setIgnoreMouseEvents(enabled, { forward: true })
})
ipcMain.on('pet:quit', () => app.quit())

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 3: 프리로드 수정** — `src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { PersistedState } from '../main/store'

const petApi = {
  load: (): Promise<PersistedState | null> => ipcRenderer.invoke('pet:load'),
  save: (state: PersistedState): void => ipcRenderer.send('pet:save', state),
  setClickThrough: (enabled: boolean): void => ipcRenderer.send('pet:setClickThrough', enabled),
  quit: (): void => ipcRenderer.send('pet:quit'),
}

contextBridge.exposeInMainWorld('petApi', petApi)

export type PetApi = typeof petApi
```

- [ ] **Step 4: App 수정 — 상태 로드 + 1분 틱 + 저장** — `src/renderer/App.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import Pet from './Pet'
import { tick, type EngineConfig } from './petEngine'
import { animationStateFor } from './animation'
import { createNewPet, type Pet as PetModel } from '../core/types'
import { DEFAULT_DECAY_RATES, DEFAULT_THRESHOLDS, DEFAULT_STAGE_RULES, TICK_INTERVAL_MS } from '../core/config'
import type { PersistedState } from '../main/store'

const ENGINE: EngineConfig = {
  decayRates: DEFAULT_DECAY_RATES,
  thresholds: DEFAULT_THRESHOLDS,
  stageRules: DEFAULT_STAGE_RULES,
}

export default function App() {
  const [pet, setPet] = useState<PetModel | null>(null)
  const [position, setPosition] = useState({ x: 80, y: 80 })
  const lastTickAt = useRef<number>(Date.now())

  // 최초 로드: 저장된 상태가 있으면 경과분만큼 즉시 틱, 없으면 새 펫
  useEffect(() => {
    let cancelled = false
    window.petApi.load().then((saved: PersistedState | null) => {
      if (cancelled) return
      const now = Date.now()
      if (saved) {
        lastTickAt.current = saved.lastTickAt
        setPet(tick(saved.pet, saved.lastTickAt, now, ENGINE))
        setPosition(saved.position)
      } else {
        setPet(createNewPet('콩이', 'green', now))
      }
      lastTickAt.current = now
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 주기적 틱
  useEffect(() => {
    const id = setInterval(() => {
      setPet((prev) => {
        if (!prev) return prev
        const now = Date.now()
        const next = tick(prev, lastTickAt.current, now, ENGINE)
        lastTickAt.current = now
        return next
      })
    }, TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // 상태 변화 시 저장
  useEffect(() => {
    if (!pet) return
    window.petApi.save({ pet, position, lastTickAt: lastTickAt.current })
  }, [pet, position])

  if (!pet) return <div className="overlay" />

  return (
    <div className="overlay">
      <div style={{ position: 'absolute', left: position.x, top: position.y }}>
        <Pet animation={animationStateFor(pet)} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: 검증**

Run: `npm run typecheck` → 에러 0.
Run: `npm test` → 43 PASS (순수 테스트 영향 없음).
Run: `npm run dev` → 화면 위에 배경 없이 펫만 떠 있고(투명), 펫 외 영역 클릭은 바탕화면으로 통과된다. (이 시점엔 펫 자체도 클릭통과 상태 — Task 6에서 해제.) 앱 재시작 시 펫 위치·상태가 복원되는지 확인.

- [ ] **Step 6: 커밋**
```bash
git add -A
git commit -m "feat(app): transparent always-on-top overlay with persistence and tick loop"
```

---

## Task 6: 펫 위에서만 상호작용 (클릭통과 토글)

기본 클릭통과 상태에서, 커서가 펫 몸통 위에 들어오면 창을 상호작용 가능으로 바꾸고, 벗어나면 다시 통과시킨다. (`forward: true` 덕분에 통과 상태에서도 렌더러는 mousemove를 받는다.)

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: App에 마우스 추적·토글 추가** — `src/renderer/App.tsx` (Task 5 버전에 추가; 전체 파일):
```tsx
import { useEffect, useRef, useState } from 'react'
import Pet from './Pet'
import { tick, type EngineConfig } from './petEngine'
import { animationStateFor } from './animation'
import { isPointInRect } from './geometry'
import { createNewPet, type Pet as PetModel } from '../core/types'
import { DEFAULT_DECAY_RATES, DEFAULT_THRESHOLDS, DEFAULT_STAGE_RULES, TICK_INTERVAL_MS } from '../core/config'
import type { PersistedState } from '../main/store'

const ENGINE: EngineConfig = {
  decayRates: DEFAULT_DECAY_RATES,
  thresholds: DEFAULT_THRESHOLDS,
  stageRules: DEFAULT_STAGE_RULES,
}
const PET_SIZE = { width: 96, height: 96 }

export default function App() {
  const [pet, setPet] = useState<PetModel | null>(null)
  const [position, setPosition] = useState({ x: 80, y: 80 })
  const lastTickAt = useRef<number>(Date.now())
  const interactive = useRef<boolean>(false)
  const positionRef = useRef(position)
  positionRef.current = position

  useEffect(() => {
    let cancelled = false
    window.petApi.load().then((saved: PersistedState | null) => {
      if (cancelled) return
      const now = Date.now()
      if (saved) {
        setPet(tick(saved.pet, saved.lastTickAt, now, ENGINE))
        setPosition(saved.position)
      } else {
        setPet(createNewPet('콩이', 'green', now))
      }
      lastTickAt.current = now
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setPet((prev) => {
        if (!prev) return prev
        const now = Date.now()
        const next = tick(prev, lastTickAt.current, now, ENGINE)
        lastTickAt.current = now
        return next
      })
    }, TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!pet) return
    window.petApi.save({ pet, position, lastTickAt: lastTickAt.current })
  }, [pet, position])

  // 커서가 펫 위에 있으면 상호작용 켜기, 아니면 클릭통과
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const over = isPointInRect({ x: e.clientX, y: e.clientY }, positionRef.current, PET_SIZE)
      if (over && !interactive.current) {
        interactive.current = true
        window.petApi.setClickThrough(false)
      } else if (!over && interactive.current) {
        interactive.current = false
        window.petApi.setClickThrough(true)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  if (!pet) return <div className="overlay" />

  return (
    <div className="overlay">
      <div style={{ position: 'absolute', left: position.x, top: position.y }}>
        <Pet animation={animationStateFor(pet)} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 검증**

Run: `npm run typecheck` → 에러 0. Run: `npm test` → 43 PASS.
Run: `npm run dev` → 펫 위에 커서를 올리면 커서가 펫에 "걸리고"(grab), 펫 밖에서는 바탕화면 아이콘 클릭 등이 통과된다.

- [ ] **Step 3: 커밋**
```bash
git add src/renderer/App.tsx
git commit -m "feat(app): enable interaction only while cursor is over the pet"
```

---

## Task 7: 드래그로 펫 옮기기

펫 몸통을 눌러 끌면 위치가 따라오고, 화면 경계 안으로 클램프되며, 놓으면 저장된다.

**Files:**
- Modify: `src/renderer/App.tsx` (펫 컨테이너에 포인터 핸들러 추가)

- [ ] **Step 1: 드래그 핸들러 추가** — `App.tsx`에서 다음을 반영한다.

(1) 상단 import에 `clampToBounds` 추가:
```tsx
import { isPointInRect, clampToBounds } from './geometry'
```

(2) 컴포넌트 본문에 드래그 상태 ref 추가(다른 ref 선언부 아래):
```tsx
  const drag = useRef<{ dx: number; dy: number } | null>(null)
```

(3) 펫을 감싼 컨테이너 `div`를 아래로 교체(포인터 이벤트로 드래그 처리):
```tsx
      <div
        style={{ position: 'absolute', left: position.x, top: position.y }}
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { dx: e.clientX - position.x, dy: e.clientY - position.y }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const next = clampToBounds(
            { x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy },
            PET_SIZE,
            { width: window.innerWidth, height: window.innerHeight },
          )
          setPosition(next)
        }}
        onPointerUp={(e) => {
          ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
          drag.current = null
        }}
      >
        <Pet animation={animationStateFor(pet)} />
      </div>
```

- [ ] **Step 2: 검증**

Run: `npm run typecheck` → 에러 0. Run: `npm test` → 43 PASS.
Run: `npm run dev` → 펫을 끌어 옮길 수 있고, 화면 밖으로는 나가지 않으며, 앱 재시작 시 옮긴 위치가 유지된다.

- [ ] **Step 3: 커밋**
```bash
git add src/renderer/App.tsx
git commit -m "feat(app): drag the pet within screen bounds"
```

---

## Task 8: 컨텍스트 메뉴 (우클릭 / 길게누르기)

펫 위에서 우클릭하거나 0.5초 길게 누르면 네이티브 메뉴를 띄운다. 항목: **먹이주기**(데모 — 보상 배선 증명), **숨기기**(펫 표시 토글), **종료**.

**Files:**
- Modify: `src/main/index.ts` (네이티브 Menu + IPC)
- Modify: `src/preload/index.ts` (showContextMenu, onMenuCommand)
- Modify: `src/renderer/App.tsx` (우클릭·롱프레스 → 메뉴, 명령 처리)

- [ ] **Step 1: 메인에 컨텍스트 메뉴 추가** — `src/main/index.ts`의 import와 IPC에 추가한다.

(1) import 교체:
```ts
import { app, BrowserWindow, ipcMain, screen, Menu } from 'electron'
```

(2) `ipcMain.on('pet:quit', ...)` 아래에 추가:
```ts
ipcMain.on('pet:showContextMenu', () => {
  if (!win) return
  const template = [
    { label: '먹이주기 🍙', click: () => win?.webContents.send('pet:menuCommand', 'feed') },
    { label: '숨기기', click: () => win?.webContents.send('pet:menuCommand', 'hide') },
    { type: 'separator' as const },
    { label: '종료', click: () => app.quit() },
  ]
  Menu.buildFromTemplate(template).popup({ window: win })
})
```

- [ ] **Step 2: 프리로드 확장** — `src/preload/index.ts`의 `petApi`에 두 메서드 추가:
```ts
  showContextMenu: (): void => ipcRenderer.send('pet:showContextMenu'),
  onMenuCommand: (cb: (command: string) => void): (() => void) => {
    const handler = (_e: unknown, command: string): void => cb(command)
    ipcRenderer.on('pet:menuCommand', handler)
    return () => ipcRenderer.removeListener('pet:menuCommand', handler)
  },
```
(`petApi` 객체 안, 기존 메서드들과 같은 레벨에 콤마로 추가.)

- [ ] **Step 3: App에 메뉴 트리거·명령 처리 추가**

(1) import에 `applyReward` 추가:
```tsx
import { applyReward } from '../core/stats'
```

(2) 컴포넌트 본문에 롱프레스 타이머 ref와 메뉴 명령 구독 추가:
```tsx
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
```
```tsx
  // 메뉴 명령 처리
  useEffect(() => {
    const off = window.petApi.onMenuCommand((command) => {
      if (command === 'feed') {
        setPet((prev) => (prev && prev.status !== 'dead'
          ? { ...prev, stats: applyReward(prev.stats, { happiness: 15, health: 10 }) }
          : prev))
      } else if (command === 'hide') {
        setHidden((h) => !h)
      }
    })
    return off
  }, [])
```

(3) `hidden` 상태 추가(다른 useState 아래):
```tsx
  const [hidden, setHidden] = useState(false)
```

(4) 펫 컨테이너 `div`의 포인터 핸들러에 우클릭·롱프레스를 추가하고 `hidden`을 반영한다. 컨테이너를 아래로 교체:
```tsx
      {!hidden && (
        <div
          style={{ position: 'absolute', left: position.x, top: position.y }}
          onContextMenu={(e) => {
            e.preventDefault()
            window.petApi.showContextMenu()
          }}
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            drag.current = { dx: e.clientX - position.x, dy: e.clientY - position.y }
            longPress.current = setTimeout(() => {
              drag.current = null
              window.petApi.showContextMenu()
            }, 500)
          }}
          onPointerMove={(e) => {
            if (!drag.current) return
            if (longPress.current) {
              clearTimeout(longPress.current)
              longPress.current = null
            }
            const next = clampToBounds(
              { x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy },
              PET_SIZE,
              { width: window.innerWidth, height: window.innerHeight },
            )
            setPosition(next)
          }}
          onPointerUp={(e) => {
            ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
            drag.current = null
            if (longPress.current) {
              clearTimeout(longPress.current)
              longPress.current = null
            }
          }}
        >
          <Pet animation={animationStateFor(pet)} />
        </div>
      )}
```

- [ ] **Step 4: 검증**

Run: `npm run typecheck` → 에러 0. Run: `npm test` → 43 PASS.
Run: `npm run dev` →
- 펫 우클릭 → 메뉴 표시. 길게 누르기(0.5s) → 메뉴 표시.
- "먹이주기" → 펫이 칙칙했다면 색이 살아남(행복·건강 회복).
- "숨기기" → 펫이 사라졌다 다시 누를 항목이 없으니, 재실행 또는 메뉴 재호출로 토글 확인(주: 숨김 상태에선 펫이 없어 우클릭 불가 → 트레이는 플랜 3에서 보완).
- "종료" → 앱 종료.

- [ ] **Step 5: 커밋**
```bash
git add -A
git commit -m "feat(app): context menu with feed/hide/quit on right-click and long-press"
```

> 참고: "숨기기"는 플랜 2에선 단순 토글이라 숨긴 뒤 되돌릴 UI가 없다. 플랜 3에서 메뉴막대(트레이) 아이콘으로 표시/숨김을 제어한다.

---

## Task 9: 전체 검증 & 플랜 마무리

- [ ] **Step 1: 순수 테스트 전체** — Run: `npm test`. Expected: 43 PASS (플랜1 26 + petEngine 5 + animation 6 + geometry 6).
- [ ] **Step 2: 타입 체크** — Run: `npm run typecheck`. Expected: 에러 0.
- [ ] **Step 3: 수동 통합 체크리스트** — `npm run dev`로 다음을 모두 확인:
  - [ ] 펫이 투명 배경으로 바탕화면 위에 떠 있다.
  - [ ] 펫 밖 영역 클릭은 바탕화면/다른 앱으로 통과된다.
  - [ ] 펫 위에 커서를 올리면 상호작용된다(grab 커서).
  - [ ] 드래그로 옮길 수 있고 화면 밖으로 안 나간다.
  - [ ] 우클릭/길게누르기로 메뉴가 뜬다.
  - [ ] 먹이주기로 스탯이 회복된다.
  - [ ] 종료가 동작한다.
  - [ ] 앱 재시작 시 위치·상태가 복원된다.
- [ ] **Step 4: 워킹트리 클린 확인** — Run: `git status`.

---

## 다음 플랜 예고 (플랜 3)
- 컨트롤 패널 창(복약/영양제·물 목표 설정, 스탯·스트릭 보기).
- 알림 엔진 배선: `isMedicationDue`/`isWaterDue`로 도래 판정 → 맥 알림 + 펫 말풍선 → 확인 시 `applyReward` + 스트릭 갱신.
- 메뉴막대(트레이) 아이콘(표시/숨김·패널 열기·종료), 자동 실행, 방해금지 시간.
