import type { AnimationState } from './animation'
import type { Stats } from '../core/types'
import { spriteUrl, poseUrl, hasPoses, petPixelSize, isHybrid } from './sprites'

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
  pose?: string // 포즈 코드(idle·eat·walk_r_1 …). 있으면 포즈 이미지로 렌더
  bubbleClass?: string // 말풍선 화면 경계 보정 클래스(1#7)
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
  pose,
  bubbleClass,
}: PetProps) {
  const usePose = !!pose && hasPoses(creature)
  const url = usePose ? poseUrl(creature, stage, pose as string) : spriteUrl(creature, stage)
  const size = petPixelSize(stage)
  // 포즈 모드: 이미지 자체가 동작을 담으므로 CSS 모션·좌우반전 없음(walk_l/walk_r로 방향 표현)
  const motion = usePose ? 'pose' : chewing ? 'eat' : moving ? 'walk' : blink ? 'blink' : 'still'
  const squish = usePose ? 1 : isHybrid(creature) ? HYBRID_SQUISH : 1
  const flipX = usePose ? 1 : facing * squish
  return (
    <div className={`pet pet--${usePose ? 'idle' : animation}`} style={{ width: size, height: size }} data-testid="pet">
      {bubble && <div className={`pet__bubble${bubbleClass ? ' ' + bubbleClass : ''}`}>{bubble}</div>}
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
      <div className="pet__flip" style={{ transform: `scaleX(${flipX})` }}>
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
