// Vite가 빌드 시 에셋 URL로 변환해 준다.
const modules = import.meta.glob('./assets/pets/*/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

export type SpriteMap = Record<string, Record<number, string>>

export const sprites: SpriteMap = {}
for (const [path, url] of Object.entries(modules)) {
  const m = path.match(/pets\/([^/]+)\/(\d)\.png$/)
  if (!m) continue
  const creature = m[1]
  const stage = Number(m[2])
  ;(sprites[creature] ??= {})[stage] = url
}

export function spriteUrl(creature: string, stage: number): string | undefined {
  return sprites[creature]?.[stage]
}

export function hasCreature(creature: string): boolean {
  return sprites[creature] !== undefined
}

// 교배종(하이브리드) 여부. 폴더명이 "<base>_x_<partner>" 형식.
export function isHybrid(creature: string): boolean {
  return creature.includes('_x_')
}

// 아트가 있는 모든 교배종 id 목록 (QA 교배 테스트용)
export function listHybrids(): string[] {
  return Object.keys(sprites).filter(isHybrid)
}

// 성장단계별 표시 크기(px). 눈(얼굴) 크기를 단계 간 일정하게 유지하도록 산출(몸만 커짐).
export function petPixelSize(_stage: number): number {
  return 126 // 위젯 펫 크기 — 전 레벨(1~4)을 Lv.5 크기로 통일(사용자 요청)
}

// 캐릭터별 표시 배율. 원본 아트의 여백 차이 보정용.
// (2026-10-22) 캐릭터 스프라이트를 512×512 규격으로 통일(전 레벨·전 캐릭터 idle 300px·바닥선 y=472)하여
// cat·dragon 체감 크기가 이미 맞으므로 코드 보정은 제거. 이후 여백이 다른 새 캐릭터가 생기면 여기에만 추가.
const CREATURE_SCALE: Record<string, number> = {}
export function creatureScale(creature: string): number {
  return CREATURE_SCALE[creature] ?? 1
}

// ── 포즈 시스템 (pets/<creature>/<level>/<pose>.png) ──
// 레벨=아이템 단계(1=기본·2=턱받이·3=리본 …). 포즈 파일명은 레벨 무관 동일.
const poseModules = import.meta.glob('./assets/pets/*/*/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

// poses[creature][level][pose] = url
export const poses: Record<string, Record<number, Record<string, string>>> = {}
for (const [path, url] of Object.entries(poseModules)) {
  const m = path.match(/pets\/([^/]+)\/(\d+)\/([^/]+)\.png$/)
  if (!m) continue
  const creature = m[1]
  const level = Number(m[2])
  const pose = m[3]
  ;(((poses[creature] ??= {})[level] ??= {}) as Record<string, string>)[pose] = url
}

export function hasPoses(creature: string): boolean {
  return poses[creature] !== undefined
}

// 현재 레벨의 포즈 URL. 해당 레벨 이미지가 없으면 3→2→1 로 자동 대체(Lv.4·5는 Lv.3 사용).
// 포즈 코드가 없으면 같은 규칙으로 idle 로 대체.
export function poseUrl(creature: string, level: number, pose: string): string | undefined {
  const byLv = poses[creature]
  if (!byLv) return undefined
  const tryLevels = [level, 3, 2, 1].filter((v, i, a) => a.indexOf(v) === i)
  for (const lv of tryLevels) {
    const u = byLv[lv]?.[pose]
    if (u) return u
  }
  for (const lv of tryLevels) {
    const u = byLv[lv]?.['idle']
    if (u) return u
  }
  return undefined
}

// ── 방 배경 — 캐릭터별 분리. 현재 캐릭터에 맞는 방이 뜬다. 배경 없는 캐릭터는 빈 방 ──
// 루트(assets/room/<하트임계>.png) = 냥냥퐁(cat) 기존 배경 / 하위폴더(assets/room/<캐릭터>/<하트임계>.png) = 캐릭터별 배경(예: room/dragon/…)
const rootRoomModules = import.meta.glob('./assets/room/*.png', { eager: true, import: 'default' }) as Record<string, string>
const subRoomModules = import.meta.glob('./assets/room/*/*.png', { eager: true, import: 'default' }) as Record<string, string>
const roomBgs: Record<string, Record<number, string>> = {}
for (const [path, url] of Object.entries(rootRoomModules)) {
  const m = path.match(/room\/(\d+)\.png$/)
  if (m) (roomBgs['cat'] ??= {})[Number(m[1])] = url
}
for (const [path, url] of Object.entries(subRoomModules)) {
  const m = path.match(/room\/([^/]+)\/(\d+)\.png$/)
  if (m) (roomBgs[m[1]] ??= {})[Number(m[2])] = url
}
// 캐릭터+누적 하트에 맞는 방 배경(없는 단계는 바로 아래 단계로 대체). 해당 캐릭터 배경이 아예 없으면 undefined(빈 방).
export function roomBgFor(creature: string, hearts: number): string | undefined {
  const byHearts = roomBgs[creature]
  if (!byHearts) return undefined // 배경 미제공 캐릭터(예: 아직 배경 없는 dragon) → 빈 방
  for (const t of [400, 340, 280, 210, 150, 100, 60, 30, 10, 0]) {
    if (hearts >= t && byHearts[t]) return byHearts[t]
  }
  return byHearts[0]
}

// ── 펫 도감 에셋 (assets/dex/*.png) — frame(테두리) · mystery(미스터리 박스) ──
const dexModules = import.meta.glob('./assets/dex/*.png', { eager: true, import: 'default' }) as Record<string, string>
const dexImgs: Record<string, string> = {}
for (const [path, url] of Object.entries(dexModules)) {
  const m = path.match(/dex\/(.+)\.png$/)
  if (m) dexImgs[m[1]] = url
}
export const dexImg = (name: string): string | undefined => dexImgs[name]
