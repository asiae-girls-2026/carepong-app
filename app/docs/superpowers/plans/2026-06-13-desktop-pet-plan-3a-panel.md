# 데스크탑 펫 — 플랜 3a: 건강 설정 + 컨트롤 패널 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 복약/영양제와 물 목표를 등록·편집·삭제할 수 있는 **별도 컨트롤 패널 창**을 만들고, 그 설정을 로컬에 영속화한다. 패널에서 펫의 현재 상태(단계·상태·스탯)도 본다. (알림이 실제로 울리는 건 플랜 3b.)

**Architecture:** Electron 두 번째 창(일반 창)으로 패널을 띄운다. 설정 데이터(HealthConfig = 복약 목록 + 물 설정)는 순수 타입/조작 함수로 코어에 두고 TDD한다. electron-store에 영속화하고 IPC로 패널↔메인을 잇는다. 패널은 저장된 펫 스냅샷을 읽어 스탯을 보여준다.

**Tech Stack:** Electron + electron-vite(멀티 렌더러 엔트리) + React + TypeScript, electron-store. 기존 `src/core/scheduler.ts`의 `MedSchedule`/`WaterConfig`를 재사용.

**참고 스펙:** `docs/superpowers/specs/2026-06-11-desktop-pet-design.md` §5.2(컨트롤 패널), §7(데이터 모델), §8(알림). 결정: 복약=이름+여러시간+요일+영양제여부, 패널 진입=우클릭 "설정 열기 ⚙️".

---

## File Structure

| 파일 | 책임 | 신규/수정 |
| --- | --- | --- |
| `src/core/health.ts` | HealthConfig 타입 + 복약/물 순수 조작 함수 | 신규(순수, TDD) |
| `src/core/health.test.ts` | 단위 테스트 | 신규 |
| `src/main/store.ts` | HealthConfig 영속화(load/save) 추가 | 수정 |
| `src/main/index.ts` | 패널 창 생성, config IPC, 메뉴 항목 | 수정 |
| `src/preload/index.ts` | loadConfig/saveConfig 브리지 | 수정 |
| `electron.vite.config.ts` | panel.html 렌더러 엔트리 추가 | 수정 |
| `src/renderer/panel.html` | 패널 진입 HTML | 신규 |
| `src/renderer/panel.tsx` | 패널 React 마운트 | 신규 |
| `src/renderer/Panel.tsx` | 패널 UI(스탯·복약·물) | 신규 |
| `src/renderer/panel.css` | 패널 스타일(무채색+레드 포인트) | 신규 |

---

## Task 1: 건강 설정 코어 (`health.ts`)

`HealthConfig`와 복약 목록·물 설정을 다루는 순수 함수. id는 외부에서 주입(테스트 결정성).

**Files:**
- Create: `src/core/health.ts`
- Test: `src/core/health.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/core/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_HEALTH_CONFIG,
  createMed,
  addMed,
  removeMed,
  updateMed,
  setWater,
  type HealthConfig,
} from './health'

const base: HealthConfig = { medications: [], water: { dailyTargetCups: 8, intervalMinutes: 90 } }

describe('health config', () => {
  it('기본 설정은 빈 복약 목록과 물 기본값', () => {
    expect(DEFAULT_HEALTH_CONFIG.medications).toEqual([])
    expect(DEFAULT_HEALTH_CONFIG.water).toEqual({ dailyTargetCups: 8, intervalMinutes: 90 })
  })

  it('createMed는 주어진 값으로 복약을 만든다', () => {
    const med = createMed('m1', '비타민D', true, ['09:00', '21:00'], [])
    expect(med).toEqual({ id: 'm1', name: '비타민D', isSupplement: true, times: ['09:00', '21:00'], days: [] })
  })

  it('addMed는 복약을 추가한다', () => {
    const med = createMed('m1', '오메가3', true, ['08:00'], [1, 3, 5])
    expect(addMed(base, med).medications).toEqual([med])
  })

  it('removeMed는 id로 제거한다', () => {
    const a = createMed('a', '약A', false, ['09:00'], [])
    const b = createMed('b', '약B', false, ['10:00'], [])
    const cfg = addMed(addMed(base, a), b)
    expect(removeMed(cfg, 'a').medications).toEqual([b])
  })

  it('updateMed는 id로 부분 수정한다', () => {
    const a = createMed('a', '약A', false, ['09:00'], [])
    const cfg = addMed(base, a)
    expect(updateMed(cfg, 'a', { name: '약A2', times: ['07:00'] }).medications[0]).toEqual({
      id: 'a',
      name: '약A2',
      isSupplement: false,
      times: ['07:00'],
      days: [],
    })
  })

  it('setWater는 물 설정을 교체한다', () => {
    expect(setWater(base, { dailyTargetCups: 10, intervalMinutes: 60 }).water).toEqual({
      dailyTargetCups: 10,
      intervalMinutes: 60,
    })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npm test -- health`. Expected: FAIL(module missing).

- [ ] **Step 3: 최소 구현 작성** — `src/core/health.ts`:
```ts
import type { MedSchedule, WaterConfig } from './scheduler'

export interface HealthConfig {
  medications: MedSchedule[]
  water: WaterConfig
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  medications: [],
  water: { dailyTargetCups: 8, intervalMinutes: 90 },
}

export function createMed(
  id: string,
  name: string,
  isSupplement: boolean,
  times: string[],
  days: number[],
): MedSchedule {
  return { id, name, isSupplement, times, days }
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
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test -- health`. Expected: PASS(6 tests).

- [ ] **Step 5: 커밋**
```bash
git add src/core/health.ts src/core/health.test.ts
git commit -m "feat(core): health config types and pure med/water operations"
```

---

## Task 2: 영속화 + 패널 창 + IPC + 메뉴 (윙잉 플러밍)

**Files:**
- Modify: `src/main/store.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `electron.vite.config.ts`

- [ ] **Step 1: store에 HealthConfig 영속화 추가** — `src/main/store.ts`를 아래로 만든다(기존 PersistedState 유지):
```ts
import Store from 'electron-store'
import type { Pet } from '../core/types'
import { type HealthConfig, DEFAULT_HEALTH_CONFIG } from '../core/health'

export interface PersistedState {
  pet: Pet
  position: { x: number; y: number }
  lastTickAt: number
}

const store = new Store<{ state: PersistedState | null; health: HealthConfig }>({
  defaults: { state: null, health: DEFAULT_HEALTH_CONFIG },
})

export function loadState(): PersistedState | null {
  return store.get('state')
}
export function saveState(state: PersistedState): void {
  store.set('state', state)
}
export function loadHealth(): HealthConfig {
  return store.get('health')
}
export function saveHealth(config: HealthConfig): void {
  store.set('health', config)
}
```

- [ ] **Step 2: electron.vite.config.ts에 panel 엔트리 추가** — renderer.build.rollupOptions.input을 아래로:
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
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          panel: resolve(__dirname, 'src/renderer/panel.html'),
        },
      },
    },
    plugins: [react()],
  },
})
```

- [ ] **Step 3: 프리로드에 config 브리지 추가** — `src/preload/index.ts`의 `petApi`에 두 메서드를 추가(기존 메서드 유지):
```ts
import type { HealthConfig } from '../core/health'
```
그리고 petApi 객체 안에:
```ts
  loadConfig: (): Promise<HealthConfig> => ipcRenderer.invoke('config:load'),
  saveConfig: (config: HealthConfig): void => ipcRenderer.send('config:save', config),
```

- [ ] **Step 4: 메인에 패널 창 + IPC + 메뉴 추가** — `src/main/index.ts`:

(1) import에 store 함수와 타입 추가:
```ts
import { loadState, saveState, loadHealth, saveHealth, type PersistedState } from './store'
import type { HealthConfig } from '../core/health'
```

(2) `let win` 아래에 패널 창 변수와 생성 함수 추가:
```ts
let panel: BrowserWindow | null = null

function openPanelWindow(): void {
  if (panel && !panel.isDestroyed()) {
    panel.focus()
    return
  }
  panel = new BrowserWindow({
    width: 440,
    height: 600,
    title: '콩이 건강 설정',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  })
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) {
    panel.loadURL(`${url}/panel.html`)
  } else {
    panel.loadFile(join(__dirname, '../renderer/panel.html'))
  }
  panel.on('closed', () => {
    panel = null
  })
}
```

(3) config IPC 핸들러 추가(다른 ipcMain 등록부 옆):
```ts
ipcMain.handle('config:load', (): HealthConfig => loadHealth())
ipcMain.on('config:save', (_e, config: HealthConfig) => saveHealth(config))
```

(4) 컨텍스트 메뉴 템플릿에 '설정 열기' 항목 추가('상태 확인하기' 아래, '숨기기' 위):
```ts
    { label: '설정 열기 ⚙️', click: () => openPanelWindow() },
```

- [ ] **Step 5: 빌드·타입체크 검증**

Run: `npm run typecheck` → 0 errors.
Run: `npm test` → 기존 + health 6 모두 PASS.
Run: `npm run build` → 성공(렌더러 엔트리 2개: index, panel). panel.html이 아직 없으면 빌드 실패하므로, 이 Step의 build 검증은 Task 3 완료 후 수행한다. 여기서는 `npm run typecheck`와 `npm test`만 확인.

- [ ] **Step 6: 커밋**
```bash
git add -A
git commit -m "feat(main): panel window, health config IPC/persistence, settings menu"
```

---

## Task 3: 컨트롤 패널 UI (`panel.html`, `panel.tsx`, `Panel.tsx`, `panel.css`)

**Files:**
- Create: `src/renderer/panel.html`
- Create: `src/renderer/panel.tsx`
- Create: `src/renderer/Panel.tsx`
- Create: `src/renderer/panel.css`

- [ ] **Step 1: `panel.html` 작성**
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>콩이 건강 설정</title>
  </head>
  <body>
    <div id="panel-root"></div>
    <script type="module" src="./panel.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: `panel.tsx` 작성**
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import Panel from './Panel'
import './panel.css'

createRoot(document.getElementById('panel-root')!).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
)
```

- [ ] **Step 3: `Panel.tsx` 작성**
```tsx
import { useEffect, useState } from 'react'
import {
  DEFAULT_HEALTH_CONFIG,
  createMed,
  addMed,
  removeMed,
  setWater,
  type HealthConfig,
} from '../core/health'
import type { Pet } from '../core/types'

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const STATUS_LABEL: Record<string, string> = {
  healthy: '건강함 😊',
  sick: '아픔 🤒',
  critical: '위독 🚨',
  dead: '무지개다리 🌈',
}

export default function Panel() {
  const [config, setConfig] = useState<HealthConfig>(DEFAULT_HEALTH_CONFIG)
  const [pet, setPet] = useState<Pet | null>(null)

  const [name, setName] = useState('')
  const [isSupp, setIsSupp] = useState(false)
  const [times, setTimes] = useState<string[]>(['09:00'])
  const [days, setDays] = useState<number[]>([])

  useEffect(() => {
    window.petApi.loadConfig().then(setConfig)
    window.petApi.load().then((s) => setPet(s ? s.pet : null))
  }, [])

  const persist = (next: HealthConfig): void => {
    setConfig(next)
    window.petApi.saveConfig(next)
  }

  const toggleDay = (d: number): void =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))

  const setTime = (i: number, v: string): void =>
    setTimes((prev) => prev.map((t, idx) => (idx === i ? v : t)))
  const addTime = (): void => setTimes((prev) => [...prev, '12:00'])
  const removeTime = (i: number): void =>
    setTimes((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))

  const onAddMed = (): void => {
    if (!name.trim()) return
    const med = createMed(crypto.randomUUID(), name.trim(), isSupp, times, days)
    persist(addMed(config, med))
    setName('')
    setIsSupp(false)
    setTimes(['09:00'])
    setDays([])
  }

  const onWater = (patch: Partial<HealthConfig['water']>): void =>
    persist(setWater(config, { ...config.water, ...patch }))

  return (
    <div className="panel">
      <h1 className="panel__title">콩이 건강 설정</h1>

      {pet && (
        <section className="card">
          <div className="card__head">
            펫 상태 · {pet.stage}단계 · {STATUS_LABEL[pet.status] ?? pet.status}
          </div>
          <Bar label="🩷 행복" value={pet.stats.happiness} color="#ff6b8a" />
          <Bar label="💪 건강" value={pet.stats.health} color="#5ec27a" />
          <Bar label="⚡ 기력" value={pet.stats.energy} color="#f2b441" />
        </section>
      )}

      <section className="card">
        <div className="card__head">복약 · 영양제</div>
        {config.medications.length === 0 && <p className="muted">아직 등록된 약이 없어요.</p>}
        <ul className="medlist">
          {config.medications.map((m) => (
            <li key={m.id} className="medlist__item">
              <span>
                {m.isSupplement ? '💊' : '💉'} <b>{m.name}</b> · {m.times.join(', ')}
                {m.days.length > 0 ? ` · ${m.days.map((d) => DAYS[d]).join('')}` : ' · 매일'}
              </span>
              <button className="link-danger" onClick={() => persist(removeMed(config, m.id))}>
                삭제
              </button>
            </li>
          ))}
        </ul>

        <div className="form">
          <input
            className="input"
            placeholder="약/영양제 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="checkbox">
            <input type="checkbox" checked={isSupp} onChange={(e) => setIsSupp(e.target.checked)} />
            영양제
          </label>
          <div className="times">
            {times.map((t, i) => (
              <div key={i} className="times__row">
                <input type="time" value={t} onChange={(e) => setTime(i, e.target.value)} />
                <button className="link-danger" onClick={() => removeTime(i)}>
                  −
                </button>
              </div>
            ))}
            <button className="link" onClick={addTime}>
              + 시간 추가
            </button>
          </div>
          <div className="days">
            {DAYS.map((d, i) => (
              <button
                key={i}
                className={`day${days.includes(i) ? ' day--on' : ''}`}
                onClick={() => toggleDay(i)}
              >
                {d}
              </button>
            ))}
            <span className="muted">{days.length === 0 ? '(매일)' : ''}</span>
          </div>
          <button className="btn" onClick={onAddMed}>
            추가
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card__head">물 마시기</div>
        <label className="row">
          하루 목표(컵)
          <input
            type="number"
            min={1}
            max={20}
            value={config.water.dailyTargetCups}
            onChange={(e) => onWater({ dailyTargetCups: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          알림 간격(분)
          <input
            type="number"
            min={15}
            max={240}
            step={15}
            value={config.water.intervalMinutes}
            onChange={(e) => onWater({ intervalMinutes: Number(e.target.value) })}
          />
        </label>
      </section>
    </div>
  )
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bar">
      <span className="bar__label">{label}</span>
      <span className="bar__track">
        <span
          className="bar__fill"
          style={{ width: `${Math.max(0, Math.min(100, Math.round(value)))}%`, background: color }}
        />
      </span>
    </div>
  )
}
```

- [ ] **Step 4: `panel.css` 작성**
```css
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #f5f5f6; color: #1c1c1e; }
.panel { padding: 16px; max-width: 460px; margin: 0 auto; }
.panel__title { font-size: 17px; margin: 4px 0 14px; }
.card { background: #fff; border-radius: 12px; padding: 14px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.card__head { font-weight: 700; font-size: 13px; margin-bottom: 10px; }
.muted { color: #8e8e93; font-size: 12px; margin: 4px 0; }

.bar { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
.bar__label { width: 56px; font-size: 12px; }
.bar__track { flex: 1; height: 8px; background: #ececef; border-radius: 5px; overflow: hidden; }
.bar__fill { display: block; height: 100%; border-radius: 5px; }

.medlist { list-style: none; padding: 0; margin: 0 0 10px; }
.medlist__item { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 6px 0; border-bottom: 1px solid #f0f0f2; }

.form { display: flex; flex-direction: column; gap: 8px; }
.input { padding: 8px; border: 1px solid #d8d8dc; border-radius: 8px; font-size: 13px; }
.checkbox { font-size: 13px; display: flex; gap: 6px; align-items: center; }
.times { display: flex; flex-direction: column; gap: 6px; }
.times__row { display: flex; gap: 8px; align-items: center; }
.days { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.day { width: 30px; height: 30px; border-radius: 50%; border: 1px solid #d8d8dc; background: #fff; cursor: pointer; font-size: 12px; }
.day--on { background: #e4002b; color: #fff; border-color: #e4002b; }

.row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin: 6px 0; }
.row input { width: 80px; padding: 6px; border: 1px solid #d8d8dc; border-radius: 8px; }

.btn { padding: 9px; border: none; border-radius: 8px; background: #e4002b; color: #fff; font-weight: 700; cursor: pointer; font-size: 13px; }
.link { background: none; border: none; color: #007aff; cursor: pointer; font-size: 12px; align-self: flex-start; padding: 0; }
.link-danger { background: none; border: none; color: #e4002b; cursor: pointer; font-size: 12px; padding: 0; }
```

- [ ] **Step 5: 검증**

Run: `npm run typecheck` → 0 errors.
Run: `npm test` → 모두 PASS.
Run: `npm run build` → 성공(index + panel 두 엔트리 빌드).
Run: `npm run dev` → 펫 우클릭 → "설정 열기 ⚙️" → 패널 창이 뜨고: 펫 상태 표시, 약 추가/삭제, 물 목표 변경이 되고, 창을 닫았다 다시 열어도 값이 유지된다(영속화). (수동 확인)

- [ ] **Step 6: 커밋**
```bash
git add -A
git commit -m "feat(panel): control panel UI for meds, water goal, and pet stats"
```

---

## Task 4: 전체 검증

- [ ] **Step 1:** `npm test` → 전체 PASS (기존 49 + health 6 = 55).
- [ ] **Step 2:** `npm run typecheck` → 0 errors.
- [ ] **Step 3:** `npm run build` → 성공.
- [ ] **Step 4: 수동 체크리스트** (`npm run dev`):
  - [ ] 우클릭 메뉴에 "설정 열기 ⚙️"가 있고 패널 창이 뜬다.
  - [ ] 약/영양제를 이름·여러 시간·요일·영양제여부로 추가하고 목록에 보인다.
  - [ ] 삭제가 된다.
  - [ ] 물 목표(컵/간격)를 바꿀 수 있다.
  - [ ] 패널을 닫았다 다시 열어도 설정이 유지된다.
  - [ ] 펫 상태(단계·상태·스탯 바)가 보인다.

---

## 다음 (플랜 3b 예고)
- 메인/렌더러에서 HealthConfig를 읽어 `isMedicationDue`/`isWaterDue`로 도래 판정(스케줄러 틱).
- 도래 시 맥 네이티브 알림 + 펫 말풍선("먹었어요/물 마셨어요" 버튼).
- 확인 시: 복약→건강↑+스트릭, 물→기력↑·건강↑(기력 회복 문제 해결), 방해금지 시간대.
- 밤 시간 자동 수면(기력 회복).
