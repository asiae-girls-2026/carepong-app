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
export function petPixelSize(stage: number): number {
  return [0, 72, 81, 96, 96, 109][stage] ?? 96
}
