import type { AnimationState } from './animation'
import type { Stats } from '../core/types'
import { spriteUrl, petPixelSize, isHybrid } from './sprites'

// 교배종 스프라이트가 세로로 찌부됨 → 가로를 줄여 정비율 보정
const HYBRID_SQUISH = 0.85

interface PetProps {
  creature: string
  stage: number
  generation: number
  animation: AnimationState
  chewing: boolean
  gauge: boolean
  moving: boolean
  blink: boolean
  facing: number
  stats: Stats
  bubble: string | null
}

export default function Pet({
  creature,
  stage,
  generation,
  animation,
  chewing,
  gauge,
  moving,
  blink,
  facing,
  stats,
  bubble,
}: PetProps) {
  const url = spriteUrl(creature, stage)
  const size = petPixelSize(stage)
  const motion = chewing ? 'eat' : moving ? 'walk' : blink ? 'blink' : 'still'
  const squish = isHybrid(creature) ? HYBRID_SQUISH : 1
  return (
    <div className={`pet pet--${animation}`} style={{ width: size, height: size }} data-testid="pet">
      {bubble && <div className="pet__bubble">{bubble}</div>}
      {gauge && !bubble && (
        <div className="pet__gauge">
          <div className="pet__gauge-head">
            Lv.{stage} · {generation}번째 아이
          </div>
          <GaugeBar icon="🩷" value={stats.happiness} color="#ff6b8a" />
          <GaugeBar icon="💪" value={stats.health} color="#5ec27a" />
          <GaugeBar icon="⚡" value={stats.energy} color="#f2b441" />
        </div>
      )}
      <div className="pet__flip" style={{ transform: `scaleX(${facing * squish})` }}>
        {url && (
          <img
            className={`pet__img pet__img--${motion}`}
            src={url}
            alt={creature}
            draggable={false}
            style={{ width: size, height: size }}
          />
        )}
      </div>
    </div>
  )
}

function GaugeBar({ icon, value, color }: { icon: string; value: number; color: string }) {
  return (
    <div className="gaugebar">
      <span className="gaugebar__icon">{icon}</span>
      <span className="gaugebar__track">
        <span
          className="gaugebar__fill"
          style={{ width: `${Math.max(0, Math.min(100, Math.round(value)))}%`, background: color }}
        />
      </span>
    </div>
  )
}
