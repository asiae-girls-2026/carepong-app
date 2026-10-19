// 스트레스 개입 — 심호흡 · 명상 (규칙서 3.스트레스 개입)
// 완료 시에만 보상 · 거절/중단해도 페널티 없음.
// 심호흡 UI는 Apple Watch Breathe·Calm Breathe Bubble 패턴:
// 들이쉴 때 버블이 크게 팽창, 내쉴 때 수축 + 큰 단계 라벨·카운트다운으로 타이밍을 명확히.
import { useCallback, useEffect, useRef, useState } from 'react'
import { poseUrl, spriteUrl } from './sprites'

export type ReliefKind = 'breath' | 'meditate'
type Mode = 'menu' | 'scale' | ReliefKind

// 음성 안내(TTS) — 눈을 감고도 '들이쉬고/내쉬고' 타이밍을 알 수 있게 단계 멘트를 읽어준다.
// Web Speech API. 음성이 없는 환경(미설치·미지원)은 조용히 무시한다.
function speak(text: string): void {
  try {
    const s = window.speechSynthesis
    if (!s) return
    s.cancel() // 이전 멘트 끊고 현재 단계만 말한다(겹침 방지)
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ko-KR'
    u.rate = 0.92
    s.speak(u)
  } catch {
    /* TTS 미지원 환경 무시 */
  }
}
function stopSpeak(): void {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* 무시 */
  }
}

// 한글 받침 유무로 조사 선택 — 이름+조사. 받침 있으면 withB("둥"+"과"→"둥과"), 없으면 withoutB("퐁이"+"와"→"퐁이와")
const josa = (name: string, withB: string, withoutB: string): string => {
  const c = name.charCodeAt(name.length - 1)
  const hasBatchim = !Number.isNaN(c) && c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0
  return name + (hasBatchim ? withB : withoutB) // 한글 음절이 아니면(영문·숫자 등) 받침 없음으로 처리
}

interface ReliefOverlayProps {
  petImg: string | null
  petName: string
  creature: string
  stage: number
  onComplete: (kind: ReliefKind) => void
  onClose: () => void
  onSelect?: (kind: ReliefKind) => void // 심호흡/명상 선택 시 (relief_selected 기록)
  askScale?: boolean // Route1: [예] 뒤 1~5 정도 선택(수집용)
  showChat?: boolean // Route1: 완화메뉴에 [{펫이름}과 얘기하기] 3번째 노출
  onScale?: (v: number) => void // 1~5 선택 기록
  onChat?: () => void // 공감챗봇 열기
}

const BREATH_PHASES = [
  { key: 'in', label: '숨을 깊게 들이쉬세요', arrow: '↑', secs: 4, scale: 1.18 },
  { key: 'hold', label: '잠시 멈추세요', arrow: '●', secs: 7, scale: 1.18 },
  { key: 'out', label: '천천히 내쉬세요', arrow: '↓', secs: 8, scale: 0.55 },
] as const
const BREATH_CYCLES = 3

function BreathGuide({ creature, stage, petImg, onDone }: { creature: string; stage: number; petImg: string | null; onDone: () => void }) {
  const [phaseIdx, setPhaseIdx] = useState(0)
  const [cycle, setCycle] = useState(1)
  const [left, setLeft] = useState<number>(BREATH_PHASES[0].secs)
  const [started, setStarted] = useState(false) // 첫 프레임엔 축소 상태로 시작 → 들이쉬기에서 팽창이 보이게
  const phase = BREATH_PHASES[phaseIdx]

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), 60)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    setLeft(phase.secs)
    speak(phase.label) // 현재 단계(들이쉬세요/멈추세요/내쉬세요)를 음성으로 안내
    const iv = setInterval(() => setLeft((s) => Math.max(s - 1, 0)), 1000)
    const to = setTimeout(() => {
      if (phaseIdx === BREATH_PHASES.length - 1) {
        if (cycle >= BREATH_CYCLES) {
          onDone()
          return
        }
        setCycle((c) => c + 1)
        setPhaseIdx(0)
      } else {
        setPhaseIdx((i) => i + 1)
      }
    }, phase.secs * 1000)
    return () => {
      clearInterval(iv)
      clearTimeout(to)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseIdx, cycle])

  // 심호흡 화면을 벗어나면(언마운트) 말하던 음성 중단
  useEffect(() => stopSpeak, [])

  const scale = started ? phase.scale : 0.55
  // 들숨=breath_in · 멈춤=breath_in(참은 상태) · 날숨=breath_out
  const breathImg =
    poseUrl(creature, stage, phase.key === 'out' ? 'breath_out' : 'breath_in') ??
    poseUrl(creature, stage, 'idle') ??
    spriteUrl(creature, stage) ??
    petImg
  return (
    <div className="breath">
      {/* 단계 라벨 — 지금 뭘 해야 하는지 크게 */}
      <p className={`breath__phase breath__phase--${phase.key}`}>
        <span className="breath__arrow">{phase.arrow}</span> {phase.label}
      </p>

      {/* 숨결 버블 — 들이쉬면 커지고, 내쉬면 작아진다 */}
      <div className="breath__stage">
        <div
          className={`breath__bubble breath__bubble--${phase.key}`}
          style={{ transform: `scale(${scale})`, transition: `transform ${phase.secs}s cubic-bezier(0.45, 0, 0.55, 1)` }}
        >
          <span className="breath__ring" />
          <span className="breath__ring breath__ring--2" />
          {breathImg ? <img src={breathImg} alt="" draggable={false} /> : <span className="relief__fallback">🫧</span>}
        </div>
        <span className="breath__count" aria-live="polite">{left}</span>
      </div>

      {/* 회차 점 */}
      <p className="breath__cycles" aria-label={`${cycle}번째 호흡`}>
        {Array.from({ length: BREATH_CYCLES }, (_, i) => (
          <i key={i} className={i < cycle ? 'on' : ''} />
        ))}
      </p>
      <p className="relief__hint">4-7-8 호흡 · 버블을 따라 같이 숨 쉬어요</p>
    </div>
  )
}

// 짧은 가이드 명상 (주의 집중) — 90초, 15초마다 안내 문구 전환 + 전체 진행 바
const MEDIT_SECONDS = 90
const MEDIT_LINES = [
  '편하게 앉아서, 눈을 살짝 감아도 좋아요',
  '숨이 들어오고 나가는 것만 가만히 느껴보세요',
  '생각이 떠오르면, 알아차리고 다시 숨으로 돌아와요',
  '어깨의 힘을 스르르 풀어보세요',
  '지금 이 순간, 여기 있는 것만으로 충분해요',
  '마지막으로 깊게 한 번, 들이쉬고… 내쉬어요',
]

function MeditateGuide({ creature, stage, petImg, onDone }: { creature: string; stage: number; petImg: string | null; onDone: () => void }) {
  const [left, setLeft] = useState(MEDIT_SECONDS)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    const iv = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(iv)
          onDoneRef.current()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [])
  const lineIdx = Math.min(
    MEDIT_LINES.length - 1,
    Math.floor(((MEDIT_SECONDS - left) / MEDIT_SECONDS) * MEDIT_LINES.length),
  )
  // 안내 문구가 바뀔 때마다 음성으로 읽어준다(눈 감고도 따라갈 수 있게). 화면 벗어나면 중단.
  useEffect(() => { speak(MEDIT_LINES[lineIdx]) }, [lineIdx])
  useEffect(() => stopSpeak, [])
  const pct = Math.round(((MEDIT_SECONDS - left) / MEDIT_SECONDS) * 100)
  const meditImg =
    poseUrl(creature, stage, 'meditate') ??
    poseUrl(creature, stage, 'rest') ??
    poseUrl(creature, stage, 'idle') ??
    spriteUrl(creature, stage) ??
    petImg
  return (
    <div className="relief__center">
      <div className="relief__breather relief__breather--calm">
        <span className="meditate__halo" />
        {meditImg ? <img src={meditImg} alt="" draggable={false} /> : <span className="relief__fallback">🧘</span>}
      </div>
      <p key={lineIdx} className="relief__title meditate__line">{MEDIT_LINES[lineIdx]}</p>
      <div className="meditate__progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="relief__sub">{left}초 남았어요 · 짧은 마음챙김 명상</p>
    </div>
  )
}

const MENU = [
  { mode: 'breath' as ReliefKind, emoji: '🫧', title: '심호흡', desc: '4-7-8 호흡 3번 · 약 1분' },
  { mode: 'meditate' as ReliefKind, emoji: '🧘', title: '짧은 명상', desc: '가이드 마음챙김 · 약 1분 30초' },
]

/** 스트레스 임계 초과 시 뜨는 즉시 완화 오버레이 */
export default function ReliefOverlay({ petImg, petName, creature, stage, onComplete, onClose, onSelect, askScale, showChat, onScale, onChat }: ReliefOverlayProps) {
  const [mode, setMode] = useState<Mode>(askScale ? 'scale' : 'menu')
  const [done, setDone] = useState<ReliefKind | null>(null)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const finishBreath = useCallback(() => setDone('breath'), [])
  const finishMeditate = useCallback(() => setDone('meditate'), [])

  useEffect(() => {
    if (done) {
      const to = setTimeout(() => onCompleteRef.current(done), 1600)
      return () => clearTimeout(to)
    }
    return undefined
  }, [done])

  // 심호흡·명상 진행 중엔 '아무 키나/아무 데나 클릭'하면 종료(눈 감고 있다가 바로 빠져나오기 쉽게). 완료 화면(done)에선 제외.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (done || (mode !== 'breath' && mode !== 'meditate')) return undefined
    const dismiss = (): void => { stopSpeak(); onCloseRef.current() }
    window.addEventListener('keydown', dismiss)
    // 모달 루트의 stopPropagation을 우회하려면 캡처 단계로 들어야 안쪽 클릭도 잡힌다
    window.addEventListener('pointerdown', dismiss, true) // 마우스/터치 아무 데나 클릭해도 종료
    return () => {
      window.removeEventListener('keydown', dismiss)
      window.removeEventListener('pointerdown', dismiss, true)
    }
  }, [mode, done])

  return (
    <div className="relief" role="dialog" aria-modal="true" aria-label="스트레스 완화" onPointerDown={(e) => e.stopPropagation()}>
      <div className="relief__card">
        {done ? (
          <div className="relief__center">
            <span className="relief__fallback">🎉</span>
            <p className="relief__title">잘하셨어요!</p>
            <p className="relief__sub">스트레스 지수가 내려갔어요</p>
          </div>
        ) : mode === 'scale' ? (
          <>
            <div className="relief__center" style={{ marginBottom: 14 }}>
              <p className="relief__title">어느 정도의 스트레스를 받고 계신 것 같나요?</p>
              <p className="relief__sub">적음 1 — 5 많음 · 편하게 골라주세요</p>
            </div>
            <div className="relief__scale">
              {[1, 2, 3, 4, 5].map((v) => (
                <button key={v} onClick={() => { onScale?.(v); setMode('menu') }}>{v}</button>
              ))}
            </div>
            <button className="relief__dismiss" onClick={onClose}>지금은 괜찮아요</button>
          </>
        ) : mode === 'menu' ? (
          <>
            <div className="relief__center" style={{ marginBottom: 14 }}>
              <p className="relief__title">그럴 땐 잠깐 쉬어가는 게 최고예요</p>
              <p className="relief__sub">{josa(petName, '이랑', '랑')} 딱 1분만! 어떤 게 좋아요?</p>
            </div>
            <div className="relief__menu">
              {MENU.map((m) => (
                <button key={m.mode} onClick={() => { onSelect?.(m.mode); setMode(m.mode) }}>
                  <span className="relief__menu-emoji" aria-hidden>
                    {m.emoji}
                  </span>
                  <span>
                    <strong>{m.title}</strong>
                    <small>{m.desc}</small>
                  </span>
                </button>
              ))}
              {showChat && (
                <button onClick={() => onChat?.()}>
                  <span className="relief__menu-emoji" aria-hidden>💬</span>
                  <span>
                    <strong>{josa(petName, '과', '와')} 얘기하기</strong>
                    <small>마음을 털어놓고 공감받기</small>
                  </span>
                </button>
              )}
            </div>
            <button className="relief__dismiss" onClick={onClose}>
              지금은 괜찮아요
            </button>
          </>
        ) : (
          <>
            {mode === 'breath' && <BreathGuide creature={creature} stage={stage} petImg={petImg} onDone={finishBreath} />}
            {mode === 'meditate' && <MeditateGuide creature={creature} stage={stage} petImg={petImg} onDone={finishMeditate} />}
            <button className="relief__dismiss" onClick={() => { stopSpeak(); onClose() }}>
              그만하기
            </button>
          </>
        )}
      </div>
    </div>
  )
}
