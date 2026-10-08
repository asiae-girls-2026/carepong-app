// 케어퐁 오버레이 — 프로토타입 (규칙서 9/22·9/23 기반)
// 죽음·친구·교배 없음. 돌봄 3종 + 알람 4종 + 스트레스 개입 + 만렙 환생.
import { useEffect, useRef, useState } from 'react'
import Pet from './Pet'
import ReliefOverlay, { type ReliefKind } from './ReliefOverlay'
import { decayDropsBetween } from './petEngine'
import { animationStateFor } from './animation'
import { isPointInRect, clampToBounds } from './geometry'
import { createNewPet, type Pet as PetModel } from '../core/types'
import { addXp, rebirth, MAX_XP, isMaxed, XP_CUMULATIVE, REBIRTH_XP, MAX_LEVEL } from '../core/progression'
import { applyCare, type CareKind } from '../core/care'
import {
  DECAY_HOURS,
  DECAY_DROP,
  DEFAULT_CREATURE,
  TICK_INTERVAL_MS,
  ALARM_MED,
  ALARM_WATER,
  ALARM_STRETCH,
  ALARM_REST,
  RELIEF_BREATH,
  RELIEF_MEDITATE,
  REMINDER_CHECK_MS,
  ENERGY_OVERLOAD_AT,
  ENERGY_OVERLOAD_SUSTAIN_MS,
  MED_PRIORITY_NOTICE,
} from '../core/config'
import type { PersistedState } from '../main/store'
import { applyReward, clamp } from '../core/stats'
import {
  dueReminders,
  recordMed,
  recordWater,
  recordStretch,
  recordRest,
  recordMiss,
  canGrantXp,
  grantXp,
  canGrantRelief,
  grantRelief,
  recordFeed,
  isFull,
  type XpPart,
  EMPTY_INTAKE,
  type IntakeLog,
  type ReminderKind,
} from '../core/intake'
import { isWithinQuiet } from '../core/scheduler'
import { DEFAULT_HEALTH_CONFIG, TIMING_LABEL, MISSED_DOSE_GUIDE, type HealthConfig } from '../core/health'
import { petPixelSize, spriteUrl, poseUrl } from './sprites'

type Reminder = { kind: ReminderKind; id: string; label: string; alarmId?: string; shownAt?: string }
const SNOOZE_MS = 30 * 60 * 1000
const REMINDER_AUTO_MS = 30 * 1000 // 무응답 시 자동 닫힘(벌점 없음 · 클릭 가로채기 방지)

const WANDER_MS = 33
const IDLE_SPEED = 0.8
const WALK_SPEED = 3.0
const IDLE_RANGE = 55
const WALK_DURATION_MS = 10_000
const SAVE_INTERVAL_MS = 15_000
// QA 전용 동작 플래그 — 최종 공개 배포 전엔 false로(완화 쿨다운 정상 적용). ChatApp의 QA_MODE와 같이 맞추세요.
const QA_MODE = true
const CHEW_MS = 1000
const EAT_ANIM_MS = 2200 // 밥 포즈 5컷 재생 길이(연출용 · 게이지 로직과 별개)
const PAT_ANIM_MS = 1300 // 쓰다듬 포즈 3컷(pat_1→pat_2→face_happy)
const WALK_FRAME_MS = 180 // 걷기 프레임 전환 간격
const GAUGE_MS = 2500

const FEED_MSGS = ['냠냠, 잘 먹었어요! 😋', '기운이 나요! 고마워요 🍚', '오물오물… 맛있어요 🥰']
const PAT_MSGS = ['쓰담쓰담… 기분 좋아요 🖐️💛', '집사님 손은 참 따뜻해요~', '헤헤, 저도 집사님을 챙겨드릴게요!']
const WALK_MSGS = ['같이 산책해요~ 어깨도 쭉 펴보세요! 🚶', '잠깐 걸으면 머리가 맑아져요!', '바깥 공기 마시는 기분으로, 슝~']
const TIRED_MSGS = ['헥헥… 오늘은 많이 걸었어요. 잠깐 쉴게요 😵', '기력이 부족해요… 밥이나 물을 챙겨주세요 🥺']
const SLEEP_MSGS = ['밤이 깊었어요. 집사님도 이제 주무세요 😴', '저는 잘 준비할게요~ 굿나잇 🌙']
const TIRED_ENERGY = 25
const WALK_REFUSE_ENERGY = 20 // 기획서 v7: 기력<20이면 산책 거부(walk_refused)

// 알람 종류별 문구·버튼 (규칙서 2.행동 알람 — 캐릭터 안내 예시)
const REMINDER_UI: Record<ReminderKind, { text: (label: string) => string; ok: string }> = {
  medication: { text: (l) => `${l} 드실 시간이에요 💊`, ok: '먹었어요' },
  water: { text: () => '물 한 잔 어때요? 💧', ok: '마셨어요' },
  stretch: { text: () => '같이 쭉 펴볼까요? 🙆', ok: '했어요' },
  rest: { text: () => '잠깐 쉬어가요 ☁️', ok: '쉬었어요' },
}
const ALARM_REWARD: Record<ReminderKind, { health?: number; happiness?: number; energy?: number; xp: number }> = {
  medication: ALARM_MED,
  water: ALARM_WATER,
  stretch: ALARM_STRETCH,
  rest: ALARM_REST,
}

const pick = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)]

// 알람 종류 → 채원 마커 표 kind (medication → med)
const ALARM_EVENT_KIND: Record<ReminderKind, 'med' | 'water' | 'stretch' | 'rest'> = {
  medication: 'med',
  water: 'water',
  stretch: 'stretch',
  rest: 'rest',
}

// 현재 상황 → 포즈 코드 선택 (포즈 기획서 v0.3 매핑)
function pickPose(
  pet: PetModel,
  o: {
    eatUntil: number
    patUntil: number
    walkUntil: number
    moving: boolean
    facing: number
    reminderKind?: string
    night: boolean
    manualDnd: boolean
  },
  now: number,
): string {
  const dir = o.facing < 0 ? 'walk_l' : 'walk_r'
  const walkFrame = (): string => `${dir}_${(Math.floor(now / WALK_FRAME_MS) % 3) + 1}`
  // 돌봄: 밥 5컷
  if (now < o.eatUntil) {
    const seq = ['eat_hungry', 'eat', 'eat_cheek_l', 'eat_cheek_r', 'eat_full']
    const prog = 1 - (o.eatUntil - now) / EAT_ANIM_MS
    return seq[Math.min(seq.length - 1, Math.max(0, Math.floor(prog * seq.length)))]
  }
  // 돌봄: 쓰다듬 3컷
  if (now < o.patUntil) {
    const seq = ['pat_1', 'pat_2', 'face_happy']
    const prog = 1 - (o.patUntil - now) / PAT_ANIM_MS
    return seq[Math.min(seq.length - 1, Math.max(0, Math.floor(prog * seq.length)))]
  }
  // 산책(진행 중) → 방향별 3프레임 루프
  if (o.moving && now < o.walkUntil) return walkFrame()
  // 알람 포즈 (스트레칭=기지개, 휴식=휴식)
  if (o.reminderKind === 'stretch') return 'stretch_2'
  if (o.reminderKind === 'rest') return 'rest'
  // 방해금지: 야간 자동=수면 / 주간 수동=idle
  if (o.night) return 'sleep'
  if (o.manualDnd) return 'idle'
  // 평상시 배회
  if (o.moving) return walkFrame()
  // 표정 (상태 지속)
  if (pet.stats.happiness < 40) return 'face_sad'
  if (pet.stats.energy < 30) return 'face_sleepy'
  return 'idle'
}

export default function App() {
  const [pet, setPet] = useState<PetModel | null>(null)
  const [position, setPosition] = useState({ x: 80, y: 80 })
  const [hidden, setHidden] = useState(false)
  const [chewing, setChewing] = useState(false)
  const [gauge, setGauge] = useState(false)
  const [bubble, setBubble] = useState<string | null>(null)
  const [facing, setFacing] = useState(1)
  const [moving, setMoving] = useState(false)
  const [blink, setBlink] = useState(false)
  const [reminder, setReminder] = useState<Reminder | null>(null)
  const [manualDnd, setManualDnd] = useState(false)
  const [autoNight, setAutoNight] = useState(false) // 자동 방해금지(야간) 배지·말풍선용(7#3·7#4)
  const [naming, setNaming] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [levelUp, setLevelUp] = useState(0)
  const [hearts, setHearts] = useState(0)
  const [rebirthPrompt, setRebirthPrompt] = useState(false)
  const [stressAlert, setStressAlert] = useState(false)
  const [reliefOpen, setReliefOpen] = useState(false)
  const [reliefRoute1, setReliefRoute1] = useState(false) // Route1(감지 팝업)=1~5 선택+대화 선택지, Route2=2선택
  const [petOpacity, setPetOpacity] = useState(40) // 케어펫 투명도 %(방해금지 중) — 설정 연동

  const lastTickAt = useRef<number>(Date.now())
  const sessionStart = useRef<number>(Date.now())
  const interactive = useRef(false)
  const positionRef = useRef(position)
  positionRef.current = position
  const petRef = useRef<PetModel | null>(pet)
  petRef.current = pet
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gaugeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const walkEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sizeRef = useRef(96)
  const anchorRef = useRef({ x: 80, y: 80 })
  const targetRef = useRef({ x: 80, y: 80 })
  const walkUntilRef = useRef(0)
  const pauseUntilRef = useRef(0)
  const movingRef = useRef(false)
  const facingRef = useRef(1)
  const chewingRef = useRef(false)
  const eatUntilRef = useRef(0)
  const patUntilRef = useRef(0)
  const configRef = useRef<HealthConfig>(DEFAULT_HEALTH_CONFIG)
  const intakeRef = useRef<IntakeLog>(EMPTY_INTAKE)
  const reminderRef = useRef<Reminder | null>(null)
  const reminderAutoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snoozeRef = useRef<Record<string, number>>({})
  const manualDndRef = useRef(false)
  const autoNightRef = useRef<boolean | null>(null) // 야간 방해금지 진입/해제 감지(최초 null=부팅 시 말풍선 억제)
  const sleepNudgedRef = useRef(0)
  const namingRef = useRef(false)
  const rebirthRef = useRef(false)
  const stageRef = useRef<number | null>(null)
  const overloadSinceRef = useRef<number | null>(null)
  const overloadWarnedRef = useRef(false)
  const happyMaxRef = useRef(false) // 행복=100 멘트 1회
  const lowEnergyRef = useRef(false) // 기력<40 멘트 1회
  const stressAlertRef = useRef(false)
  const reliefOpenRef = useRef(false)
  const lastMouseSentRef = useRef(0)
  // 스트레스 팝업(P03) 맥락 — 서버 postWindow 응답에서 전달받아 자가보고(postSelfReport)에 실어 보냄
  const promptCtxRef = useRef<{ windowId: string | null; promptType: string; promptTime: string } | null>(null)
  const reliefSelectedRef = useRef<ReliefKind | null>(null) // 완화 선택했으나 미완료 → 중단(abandoned) 판별
  const reliefEntryRef = useRef<'stress_prompt' | 'mind_tab'>('mind_tab') // Route1(감지 팝업) / Route2(1분 쉬어가기)
  const reliefStartRef = useRef(0)
  const reliefWindowIdRef = useRef<string | null>(null)

  // 서버 전송 호출 짧은 헬퍼 (민서 api.js · 호출위치표) — 미주입 환경에서도 안전하게 no-op
  const log = (event: string, screen: string | null, props: Record<string, unknown> = {}): void =>
    window.careApi.logEvent?.(event, screen, props)

  const quiet = (): { start: string; end: string } =>
    configRef.current.quietHours ?? { start: '18:30', end: '08:30' }
  const isNight = (now: number): boolean => {
    if (configRef.current.quietEnabled === false) return false
    return isWithinQuiet(now, quiet().start, quiet().end)
  }
  const isResting = (now: number): boolean => manualDndRef.current || isNight(now)

  const petSize = pet ? petPixelSize(pet.stage) : 96
  sizeRef.current = petSize

  const saveNow = (): void => {
    if (petRef.current) {
      window.petApi.save({
        pet: petRef.current,
        position: positionRef.current,
        lastTickAt: lastTickAt.current,
      })
    }
  }

  const showGauge = (): void => {
    setGauge(true)
    if (gaugeTimer.current) clearTimeout(gaugeTimer.current)
    gaugeTimer.current = setTimeout(() => setGauge(false), GAUGE_MS)
  }

  const showBubble = (text: string, ms: number): void => {
    setBubble(text)
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
    bubbleTimer.current = setTimeout(() => setBubble(null), ms)
  }

  // XP 반영 결과 공통 처리 — 레벨업 연출 + 만렙 환생 제안
  const settle = (result: { pet: PetModel; leveledUp: boolean; maxed: boolean }): PetModel => {
    if (result.leveledUp) {
      setLevelUp((n) => n + 1)
      showBubble(`레벨업! ✨ Lv.${result.pet.stage}이 됐어요!`, 5000)
      log('level_up', 'P06', { level: result.pet.stage })
    }
    if (result.maxed && !rebirthRef.current) {
      rebirthRef.current = true
      setRebirthPrompt(true)
      interactive.current = true
      window.petApi.setClickThrough(false)
      window.petApi.notify('케어퐁', `${result.pet.name}이(가) 만렙이 됐어요! 🎓 환생할 준비가 됐어요`)
    }
    return result.pet
  }

  const alarmProps = (r: Reminder): Record<string, unknown> => ({
    alarm_id: r.alarmId,
    shown_at: r.shownAt,
    ...(r.kind === 'medication' ? { local_medication_id: r.id } : {}),
  })
  // ── 알람 처리 ──
  const clearReminder = (): void => {
    if (reminderAutoTimer.current) clearTimeout(reminderAutoTimer.current)
    reminderAutoTimer.current = null
    reminderRef.current = null
    setReminder(null)
    interactive.current = false
    window.petApi.setClickThrough(true)
  }
  const confirmReminder = (): void => {
    const r = reminderRef.current
    if (!r) return
    log('alarm_answered', 'P02', { kind: ALARM_EVENT_KIND[r.kind], answer: 'confirm', ...alarmProps(r) })
    const now = Date.now()
    if (r.kind === 'water') intakeRef.current = recordWater(intakeRef.current, now)
    else if (r.kind === 'medication') intakeRef.current = recordMed(intakeRef.current, r.id, now)
    else if (r.kind === 'stretch') intakeRef.current = recordStretch(intakeRef.current, now)
    else intakeRef.current = recordRest(intakeRef.current, now)
    window.petApi.saveIntake(intakeRef.current)
    const reward = ALARM_REWARD[r.kind]
    // XP는 파트별 하루 3회까지만 (게이지는 항상 적용) — 기획서 v10
    const part: XpPart = ALARM_EVENT_KIND[r.kind]
    const grant = canGrantXp(intakeRef.current, part, now)
    if (grant) {
      intakeRef.current = grantXp(intakeRef.current, part, now)
      window.petApi.saveIntake(intakeRef.current)
    }
    setPet((prev) => {
      if (!prev) return prev
      const rewarded: PetModel = {
        ...prev,
        stats: applyReward(prev.stats, reward),
        lifetime: { ...prev.lifetime, alarms: prev.lifetime.alarms + 1 },
      }
      return settle(addXp(rewarded, grant ? reward.xp : 0))
    })
    const wasMed = r.kind === 'medication'
    clearReminder()
    showGauge()
    if (wasMed) setTimeout(scanDue, 150) // 2#13: 같은 시각 다음 약 바로 노출(텀 제거)
  }
  const snoozeReminder = (): void => {
    const r = reminderRef.current
    if (!r) return
    log('alarm_answered', 'P02', { kind: ALARM_EVENT_KIND[r.kind], answer: 'later', ...alarmProps(r) })
    snoozeRef.current = { ...snoozeRef.current, [r.id]: Date.now() + SNOOZE_MS }
    clearReminder()
  }
  // 무응답 자동 닫힘 — 벌점 없음(규칙서), 복약만 놓침 횟수 기록
  const missReminder = (): void => {
    const r = reminderRef.current
    if (!r) return
    log('alarm_answered', 'P02', { kind: ALARM_EVENT_KIND[r.kind], answer: 'timeout', ...alarmProps(r) })
    if (r.kind === 'medication') {
      intakeRef.current = recordMiss(intakeRef.current)
      window.petApi.saveIntake(intakeRef.current)
    }
    snoozeRef.current = { ...snoozeRef.current, [r.id]: Date.now() + SNOOZE_MS }
    clearReminder()
  }

  // ── 최초 로드 (옛 형식 저장데이터는 새 펫으로 시작) ──
  useEffect(() => {
    let cancelled = false
    window.petApi.load().then((saved: PersistedState | null) => {
      if (cancelled) return
      const now = Date.now()
      const valid =
        saved &&
        saved.pet &&
        typeof saved.pet.creature === 'string' &&
        typeof (saved.pet as PetModel).xp === 'number' &&
        (saved.pet as PetModel).lifetime != null
      const start = valid ? saved.position : { x: 80, y: 80 }
      if (valid) {
        setPet(saved.pet)
        setPosition(start)
      } else {
        setPet(createNewPet('퐁이', DEFAULT_CREATURE, now))
        setNaming(true)
        namingRef.current = true
        interactive.current = true
        window.petApi.setClickThrough(false)
      }
      anchorRef.current = { ...start }
      targetRef.current = { ...start }
      // 오프라인 급감 없음(규칙서) — 켠 시점부터만 감소
      lastTickAt.current = now
    })
    return () => {
      cancelled = true
    }
  }, [])

  // ── 스탯 틱(1분) — 활성 시간만 자연 감소, 휴식 중엔 기력 회복 ──
  useEffect(() => {
    const id = setInterval(() => {
      setPet((prev) => {
        if (!prev) return prev
        const now = Date.now()
        let next = prev
        if (isResting(now)) {
          // 방해금지(밤) 중엔 자연 감소·자동 회복 모두 없음 — 회복은 밥·약·물·휴식·완화로만(기획서 11·12, Q4 자동회복 제거)
          // next = prev 유지(게이지 변화 없음)
        } else {
          // 하루 3회(11·14·17시) 고정 드롭 — 지난 틱 이후 지나온 감소 시각 수만큼 −16/−12/−20
          const drops = decayDropsBetween(lastTickAt.current, now, DECAY_HOURS)
          if (drops > 0) {
            next = {
              ...next,
              stats: {
                happiness: clamp(next.stats.happiness - DECAY_DROP.happiness * drops),
                health: clamp(next.stats.health - DECAY_DROP.health * drops),
                energy: clamp(next.stats.energy - DECAY_DROP.energy * drops),
              },
            }
          }
        }
        lastTickAt.current = now
        return next
      })
    }, TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── 자동 방해금지(야간 18:30~08:30) 진입/해제 고지 — 말풍선 1회 + 배지(7#3·7#4) ──
  useEffect(() => {
    const check = (): void => {
      const n = isNight(Date.now())
      if (autoNightRef.current === null) {
        autoNightRef.current = n // 부팅 시 현재 상태만 반영(말풍선 없이)
        setAutoNight(n)
        return
      }
      if (n !== autoNightRef.current) {
        autoNightRef.current = n
        setAutoNight(n)
        if (configRef.current.quietEnabled !== false && !manualDndRef.current) {
          showBubble(n ? '방해금지가 켜졌어요 😴 (야간 — 알람·개입 잠시 멈춤)' : '방해금지가 해제됐어요 🙆 좋은 아침이에요!', 4000)
        }
      }
    }
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    saveNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet])
  useEffect(() => {
    const id = setInterval(saveNow, SAVE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    window.petApi.loadConfig().then((c) => {
      configRef.current = c
      setPetOpacity(c.petOpacity ?? 40)
    })
    window.petApi.loadIntake().then((l) => {
      intakeRef.current = { ...EMPTY_INTAKE, ...l }
    })
    const off = window.petApi.onConfigChanged(() => {
      window.petApi.loadConfig().then((c) => {
        configRef.current = c
        setPetOpacity(c.petOpacity ?? 40)
      })
    })
    return off
  }, [])

  // 레벨업 연출 기준값
  useEffect(() => {
    if (!pet) return
    stageRef.current = pet.stage
  }, [pet])

  // 기력 '과다 방지 리미트' — ≥95가 지속되면 무리 주의(진단 아님, 고정 문구 포함)
  useEffect(() => {
    if (!pet) return
    const now = Date.now()
    if (pet.stats.energy >= ENERGY_OVERLOAD_AT) {
      if (overloadSinceRef.current == null) overloadSinceRef.current = now
      else if (now - overloadSinceRef.current >= ENERGY_OVERLOAD_SUSTAIN_MS && !overloadWarnedRef.current) {
        overloadWarnedRef.current = true
        showBubble(`혹시 무리하고 있는 건 아닐까요? 기록이 많아요. ${MED_PRIORITY_NOTICE} 🌿`, 7000)
      }
    } else {
      overloadSinceRef.current = null
      overloadWarnedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet])

  // 행복 만땅(=100) / 기력 부족(<40) 멘트 — 각 1회, 조건 벗어나면 다시 가능 (기획서 v10)
  useEffect(() => {
    if (!pet || namingRef.current || rebirthRef.current) return
    // 행복 =100
    if (pet.stats.happiness >= 100) {
      if (!happyMaxRef.current) {
        happyMaxRef.current = true
        showBubble('지금 너무너무 행복해요! 집사님 덕분이에요 💛', 5000)
      }
    } else if (pet.stats.happiness < 95) happyMaxRef.current = false
    // 기력 <40 (45 이상 회복되면 다시 가능 — 히스테리시스)
    if (pet.stats.energy < 40) {
      if (!lowEnergyRef.current) {
        lowEnergyRef.current = true
        showBubble('기운이 하나도 없어요… 밥이나 휴식으로 좀 채워주세요 🥺', 5000)
      }
    } else if (pet.stats.energy >= 45) lowEnergyRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet])

  // ── 환생 (만렙 → 새 아기) ──
  const doRebirth = (): void => {
    setRebirthPrompt(false)
    rebirthRef.current = false
    log('rebirth', 'P07', { generation: (petRef.current?.generation ?? 1) + 1 })
    setPet((prev) => (prev ? rebirth(prev, Date.now()) : prev))
    lastTickAt.current = Date.now()
    const pos = positionRef.current
    anchorRef.current = { ...pos }
    targetRef.current = { ...pos }
    setNaming(true)
    namingRef.current = true
    interactive.current = true
    window.petApi.setClickThrough(false)
    setNameInput('')
  }
  const laterRebirth = (): void => {
    setRebirthPrompt(false)
    rebirthRef.current = false // 만렙 상태 유지 — 설정 패널에서 다시 환생 가능
    interactive.current = false
    window.petApi.setClickThrough(true)
    showBubble('준비되면 언제든 말해주세요. 저는 여기 있을게요 💛', 4000)
  }

  const confirmName = (): void => {
    const nm = nameInput.trim() || petRef.current?.name || '퐁이'
    setPet((prev) => (prev ? { ...prev, name: nm } : prev))
    setNaming(false)
    namingRef.current = false
    interactive.current = false
    window.petApi.setClickThrough(true)
    log('rename', 'P07', {})
    showBubble(`반가워요! 저는 ${nm}이에요 🐣 서로 잘 돌봐줘요, 우리`, 5000)
  }

  // ── 알람 표시 + 도래 점검 ──
  const presentReminder = (d: { kind: ReminderKind; id: string; label: string }, now: number): void => {
    const r: Reminder = { ...d, alarmId: crypto.randomUUID(), shownAt: new Date(now).toISOString() }
    reminderRef.current = r
    setReminder(r)
    log('alarm_shown', 'P02', { kind: ALARM_EVENT_KIND[r.kind], ...alarmProps(r) })
    // Windows 시스템 토스트는 띄우지 않는다 — 항상 위에 뜨는 인앱 말풍선과 중복(겹침) 방지
    // 약 알람만 즉시 클릭을 잡는다 — 물·스트레칭·휴식은 말풍선에 마우스를 올렸을 때만 버튼이 눌린다
    if (r.kind === 'medication') {
      interactive.current = true
      window.petApi.setClickThrough(false)
    }
    if (reminderAutoTimer.current) clearTimeout(reminderAutoTimer.current)
    reminderAutoTimer.current = setTimeout(missReminder, REMINDER_AUTO_MS)
  }
  const scanDue = (): void => {
    if (reminderRef.current || namingRef.current || rebirthRef.current) return
    if (stressAlertRef.current || reliefOpenRef.current) return
    if (!petRef.current) return
    window.petApi.loadConfig().then((cfg) => {
      configRef.current = cfg
      if (reminderRef.current) return
      const now = Date.now()
      if (isResting(now)) return
      const due = dueReminders(cfg, intakeRef.current, now, sessionStart.current).filter(
        (d) => (snoozeRef.current[d.id] ?? 0) < now,
      )
      if (due.length === 0) return
      presentReminder(due[0], now)
    })
  }
  // 30초 주기 점검 — 약 확인 직후엔 confirmReminder에서 즉시 scanDue 재호출(2#13: 같은 시각 다음 약 바로 노출)
  useEffect(() => {
    const id = setInterval(scanDue, REMINDER_CHECK_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 자율 걷기 (앵커 주변 소폭 / 산책 시 전체 화면) ──
  useEffect(() => {
    const id = setInterval(() => {
      if (drag.current) {
        if (movingRef.current) {
          movingRef.current = false
          setMoving(false)
        }
        return
      }
      const now = Date.now()
      const canMove =
        !chewingRef.current &&
        !reminderRef.current &&
        !isResting(now) &&
        !(configRef.current.minimalMotion ?? false)
      if (!canMove) {
        if (movingRef.current) {
          movingRef.current = false
          setMoving(false)
        }
        return
      }
      const walking = now < walkUntilRef.current
      const maxX = Math.max(1, window.innerWidth - sizeRef.current)
      const maxY = Math.max(1, window.innerHeight - sizeRef.current)
      const clampX = (v: number): number => Math.max(0, Math.min(v, maxX))
      const pickTarget = (): void => {
        if (walking) {
          targetRef.current = { x: Math.random() * maxX, y: Math.random() * maxY }
        } else {
          const a = anchorRef.current
          targetRef.current = { x: clampX(a.x + (Math.random() * 2 - 1) * IDLE_RANGE), y: a.y }
          pauseUntilRef.current = now + 1500 + Math.random() * 3500
        }
      }
      if (!walking && now < pauseUntilRef.current) {
        if (movingRef.current) {
          movingRef.current = false
          setMoving(false)
        }
        return
      }
      const speed = walking ? WALK_SPEED : IDLE_SPEED
      const cur = positionRef.current
      const t = targetRef.current
      const dxp = t.x - cur.x
      const dyp = t.y - cur.y
      const dist = Math.hypot(dxp, dyp)
      if (dist <= speed) {
        pickTarget()
        if (movingRef.current) {
          movingRef.current = false
          setMoving(false)
        }
        return
      }
      if (Math.abs(dxp) > 1) {
        const dir = dxp > 0 ? 1 : -1
        if (facingRef.current !== dir) {
          facingRef.current = dir
          setFacing(dir)
        }
      }
      const npos = { x: cur.x + (dxp / dist) * speed, y: cur.y + (dyp / dist) * speed }
      positionRef.current = npos
      setPosition(npos)
      if (!movingRef.current) {
        movingRef.current = true
        setMoving(true)
      }
    }, WANDER_MS)
    return () => clearInterval(id)
  }, [])

  // 포즈 프레임 틱 — 걷기/밥/쓰다듬 프레임 전환용 리렌더
  const [, setFrameTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrameTick((t) => (t + 1) % 1_000_000), 150)
    return () => clearInterval(id)
  }, [])

  // 눈깜빡임
  useEffect(() => {
    const id = setInterval(() => {
      const p = petRef.current
      if (!p || movingRef.current || chewingRef.current) return
      if (animationStateFor(p) !== 'idle') return
      setBlink(true)
      setTimeout(() => setBlink(false), 180)
    }, 4200)
    return () => clearInterval(id)
  }, [])

  // 밤 수면 넛지 (6시간 1회)
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      if (!isResting(now) || reminderRef.current) return
      if (now - sleepNudgedRef.current > 6 * 60 * 60 * 1000) {
        sleepNudgedRef.current = now
        showBubble(pick(SLEEP_MSGS), 6000)
      }
    }, 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // ── 스트레스: 지수 구독 + 임계 초과 개입 제안 ──
  const dismissStressAlert = (): void => {
    stressAlertRef.current = false
    setStressAlert(false)
    window.careApi.snoozeAlert()
    interactive.current = false
    window.petApi.setClickThrough(true)
  }
  // 스트레스 팝업(P03) 응답 자가보고 — Route1(감지 팝업)일 때만 전송. 팝업은 자동 안 닫힘 → 4상태 중 하나로 반드시 1회
  const answerStressPrompt = (yesno: 1 | 0 | null, status: 'answered' | 'dismissed' | 'ignored' | 'pending'): void => {
    const ctx = promptCtxRef.current
    if (!ctx) return // Route2(1분 쉬어가기)·메뉴 진입은 팝업 응답이 아님
    const clickedAt = new Date().toISOString()
    void window.careApi.selfReport?.({
      windowId: ctx.windowId,
      trigger: ctx.promptType,
      yesno,
      status,
      promptTime: ctx.promptTime,
      clickedAt,
    })
    const latency_ms = new Date(clickedAt).getTime() - new Date(ctx.promptTime).getTime()
    log('stress_prompt_answered', 'P03', { answer: yesno === 1 ? 'yes' : yesno === 0 ? 'no' : 'timeout', latency_ms })
    promptCtxRef.current = null
  }
  // "아니요" — 오탐 확인 응답. 스누즈 처리 + 다행이라는 인사 (추후 감지 모델 라벨로도 활용 가능)
  const dismissNotStressed = (): void => {
    answerStressPrompt(0, 'answered')
    dismissStressAlert()
    showBubble('다행이에요! 괜히 걱정했네요 😊 하던 일 마저 하세요~', 4000)
  }
  const openRelief = (): void => {
    // 진입 경로 판별은 응답 전에 (answerStressPrompt 가 promptCtx 를 비움)
    reliefEntryRef.current = promptCtxRef.current ? 'stress_prompt' : 'mind_tab'
    reliefWindowIdRef.current = promptCtxRef.current?.windowId ?? null
    setReliefRoute1(!!promptCtxRef.current) // Route1만 1~5 선택·대화 선택지 노출
    answerStressPrompt(1, 'answered') // "예" (Route2·메뉴 진입이면 promptCtx 없어 no-op)
    stressAlertRef.current = false
    setStressAlert(false)
    reliefSelectedRef.current = null
    reliefOpenRef.current = true
    setReliefOpen(true)
    interactive.current = true
    window.petApi.setClickThrough(false)
  }
  // 완화 메뉴에서 심호흡/명상 선택 (호출위치표 D: relief_selected)
  const selectRelief = (kind: ReliefKind): void => {
    reliefSelectedRef.current = kind
    reliefStartRef.current = Date.now()
    log('relief_selected', 'P04', {
      type: kind,
      entry: reliefEntryRef.current,
      window_id: reliefWindowIdRef.current,
      report_id: null,
    })
  }
  // Route1 1~5 자가보고 — 데이터 수집용 기록만(완화 흐름엔 영향 없음) · 기획서 3-2
  const reportStressScale = (scale: number): void => {
    log('stress_scale', 'P03', { scale, window_id: reliefWindowIdRef.current })
  }
  // 완화 3번째: {펫이름}과 얘기하기 — 공감챗봇 열기. 보상 없음(하트만)·상한/쿨다운 미포함(기획서 3-2)
  const chatRelief = (): void => {
    log('relief_selected', 'P04', { type: 'chat', entry: reliefEntryRef.current, window_id: reliefWindowIdRef.current, report_id: null })
    reliefSelectedRef.current = null // 챗봇은 완료/중단 개념 없음 — abandoned 기록 방지
    closeRelief()
    window.careApi.openChat('heart')
  }
  const closeRelief = (): void => {
    // 선택 후 완료 전 닫음 → 중단(abandoned) 기록 (호출위치표 D)
    if (reliefSelectedRef.current) {
      log('relief_abandoned', 'P04', { type: reliefSelectedRef.current, step: null })
      reliefSelectedRef.current = null
    }
    reliefOpenRef.current = false
    setReliefOpen(false)
    interactive.current = false
    window.petApi.setClickThrough(true)
  }
  // 완료 시에만 보상 (규칙서: 거절·무시 페널티 없음)
  const completeRelief = (kind: ReliefKind): void => {
    const dur_ms = reliefStartRef.current ? Date.now() - reliefStartRef.current : null
    log('relief_completed', 'P04', { type: kind, dur_ms })
    reliefSelectedRef.current = null // 완료 → 중단 아님
    window.careApi.calm() // 지수 완화는 상한과 무관하게 항상
    closeRelief()
    const now = Date.now()
    // 완화 보상: 심호흡+명상 합산 하루 3회 · 쿨다운 30분(기획서 3-1·3-2). 초과 시 완화는 되지만 보상 없음
    const grant = canGrantRelief(intakeRef.current, now, QA_MODE) // QA: 쿨다운 건너뜀(하루 3회 상한은 유지)
    if (grant) {
      intakeRef.current = grantRelief(intakeRef.current, now)
      window.petApi.saveIntake(intakeRef.current)
    }
    const reward = kind === 'breath' ? RELIEF_BREATH : RELIEF_MEDITATE
    setPet((prev) => {
      if (!prev) return prev
      const base: PetModel = { ...prev, lifetime: { ...prev.lifetime, reliefs: prev.lifetime.reliefs + 1 } }
      if (!grant) return base
      return settle(addXp({ ...base, stats: applyReward(prev.stats, reward) }, reward.xp))
    })
    showBubble(
      grant
        ? '잘하셨어요! 스트레스 지수가 쭉 내려갔어요 💛'
        : '잘하셨어요! 오늘 완화 보상은 다 챙겼지만, 쉬어가는 건 언제나 좋아요 💛',
      5000,
    )
  }

  // 지수 게이지는 노출하지 않는다 — 스트레스가 감지되면 완화 제안 프롬프트로만 표시(기획 결정)
  useEffect(() => {
    const offAlert = window.careApi.onStressAlert((s) => {
      const p = petRef.current
      if (!p) return
      if (isResting(Date.now())) return
      if (reliefOpenRef.current || stressAlertRef.current || reminderRef.current) return
      stressAlertRef.current = true
      setStressAlert(true)
      interactive.current = true
      window.petApi.setClickThrough(false)
      // 서버(postWindow) 응답 맥락 저장 — 자가보고(postSelfReport)에 실어 보냄 (호출위치표 B)
      promptCtxRef.current = {
        windowId: s.windowId ?? null,
        promptType: s.promptType ?? 'spike',
        promptTime: new Date().toISOString(),
      }
      log('stress_prompt_shown', 'P03', { stress_score: s.stressScore ?? s.score, nth_today: s.nthToday ?? null })
      window.petApi.notify('케어퐁', '스트레스를 받고 계신 것 같아요. 잠깐 확인해 주세요 🥺')
    })
    return offAlert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 커서가 펫 위일 때만 클릭 받기 + 전역 마우스 이동은 디지털 마커로 수집
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const nowMs = performance.now()
      if (nowMs - lastMouseSentRef.current > 60) {
        lastMouseSentRef.current = nowMs
        window.careApi.stressEvent({ type: 'mouse', x: e.screenX, y: e.screenY, t: nowMs })
      }
      const cursor = { x: e.clientX, y: e.clientY }
      const overPet = isPointInRect(cursor, positionRef.current, {
        width: sizeRef.current,
        height: sizeRef.current,
      })
      // 알람 말풍선(펫 위쪽) 영역 — 물·스트레칭·휴식 알람은 여기 올렸을 때만 클릭 가능
      const overBubble =
        reminderRef.current != null &&
        isPointInRect(
          cursor,
          { x: positionRef.current.x + sizeRef.current / 2 - 130, y: positionRef.current.y - 165 },
          { width: 260, height: 175 },
        )
      const over = overPet || overBubble
      const medHold = reminderRef.current?.kind === 'medication' // 약 알람은 응답 전까지 유지
      if (over && !interactive.current) {
        interactive.current = true
        window.petApi.setClickThrough(false)
      } else if (
        !over &&
        interactive.current &&
        !medHold &&
        !namingRef.current &&
        !rebirthRef.current &&
        !stressAlertRef.current &&
        !reliefOpenRef.current
      ) {
        interactive.current = false
        window.petApi.setClickThrough(true)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // ── 돌봄 행동 ──
  // 게이지는 항상 올리되, XP는 파트별 하루 3회까지만 (기획서 v10)
  const careWithCap = (prev: PetModel, kind: CareKind, part: XpPart): PetModel => {
    const now = Date.now()
    const grant = canGrantXp(intakeRef.current, part, now)
    const result = applyCare(prev, kind, grant)
    if (grant) {
      intakeRef.current = grantXp(intakeRef.current, part, now)
      window.petApi.saveIntake(intakeRef.current)
    }
    return settle(result)
  }
  const doCare = (kind: CareKind): void => {
    const p = petRef.current
    if (!p) return
    // 방해금지(수동·야간) 중엔 밥·쓰다듬기·산책 모두 불가 — 쉬는 중(기획서 반영)
    if (isResting(Date.now())) {
      showBubble('지금은 쉬는 중이에요 😴 방해금지를 끄면 같이 놀 수 있어요', 3000)
      return
    }
    if (kind === 'walk') {
      // 기획서 v7 4.돌봄 E7: 기력<20 → 산책 거부(walk_refused), 소모·보상 없음
      if (p.stats.energy < WALK_REFUSE_ENERGY) {
        showBubble('지금은 좀 지쳤어요… 조금 쉬었다 가요 🥺', 3500)
        log('care_action', 'P01', { type: 'walk_refused' })
        return
      }
      walkUntilRef.current = Date.now() + WALK_DURATION_MS
      pauseUntilRef.current = 0
      targetRef.current = {
        x: Math.random() * Math.max(1, window.innerWidth - sizeRef.current),
        y: Math.random() * Math.max(1, window.innerHeight - sizeRef.current),
      }
      showBubble(pick(WALK_MSGS), WALK_DURATION_MS)
      if (walkEndTimer.current) clearTimeout(walkEndTimer.current)
      walkEndTimer.current = setTimeout(() => {
        anchorRef.current = { ...positionRef.current }
        targetRef.current = { ...positionRef.current }
        setPet((prev) => (prev ? careWithCap(prev, 'walk', 'walk') : prev))
        log('care_action', 'P01', { type: 'walk' })
        showGauge()
      }, WALK_DURATION_MS)
      return
    }
    if (kind === 'feed') {
      // 기획서 v10: 최근 1시간 내 3회 먹으면 배부름 → 거부(게이지·XP·보상 없음)
      const now = Date.now()
      // 기획서 v10: 최근 1시간 3회 → 배부름(거부). 단 기력<40이면 배부름이어도 허용 — 기력 회복 경로 보장(Q1-B-1, 교착 방지)
      if (isFull(intakeRef.current, now) && (petRef.current?.stats.energy ?? 100) >= 40) {
        showBubble('배가 너무 불러요~ 조금 쉬었다 먹을게요! 🐱', 3000)
        return
      }
      intakeRef.current = recordFeed(intakeRef.current, now)
      window.petApi.saveIntake(intakeRef.current)
      chewingRef.current = true
      setChewing(true)
      eatUntilRef.current = now + EAT_ANIM_MS
      if (chewTimer.current) clearTimeout(chewTimer.current)
      chewTimer.current = setTimeout(() => {
        chewingRef.current = false
        setChewing(false)
      }, CHEW_MS)
      showBubble(pick(FEED_MSGS), 3000)
      log('care_action', 'P01', { type: 'feed' })
    } else {
      patUntilRef.current = Date.now() + PAT_ANIM_MS
      setHearts((h) => h + 1)
      showBubble(pick(PAT_MSGS), 2500)
      log('care_action', 'P01', { type: 'pet' })
    }
    const part: XpPart = kind === 'feed' ? 'feed' : 'pat'
    setPet((prev) => (prev ? careWithCap(prev, kind, part) : prev))
    showGauge()
  }

  // ── 메뉴 명령 ──
  useEffect(() => {
    const off = window.petApi.onMenuCommand((command) => {
      if (command === 'feed' || command === 'pat' || command === 'walk') {
        doCare(command)
      } else if (command === 'status') {
        if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
        setBubble(null)
        showGauge()
      } else if (command === 'relief') {
        openRelief()
      } else if (command === 'dnd') {
        const on = !manualDndRef.current
        manualDndRef.current = on
        setManualDnd(on)
        log('dnd_toggle', 'P08', { on, src: 'menu', hour: new Date().getHours() })
        if (on && reminderRef.current) clearReminder()
        showBubble(on ? '방해금지 ON 😴 조용히 쉬면서 기력을 회복할게요' : '방해금지 OFF 🙆 다시 곁에 있을게요', 3500)
      } else if (command === 'hide') {
        if (reminderRef.current) clearReminder()
        setHidden((h) => !h)
      } else if (command === 'nextchar') {
        // 환생 가능(6,750) 시 '다음 친구 만나기' → 환생 선택 팝업 다시 표시 (기획서 v13/v14)
        const p = petRef.current
        if (p && isMaxed(p) && !rebirthRef.current) {
          rebirthRef.current = true
          setRebirthPrompt(true)
          interactive.current = true
          window.petApi.setClickThrough(false)
        }
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── QA 디버그 + 미니홈 이벤트 (대화 하트 등) ──
  useEffect(() => {
    const off = window.petApi.onDebug((action) => {
      setPet((prev) => {
        if (!prev) return prev
        if (action === 'chat') {
          // 미니홈 대화·기분 체크 1회 = 하트 1칸 (기획서 8번: 하트는 방꾸미기 전용 — XP·게이지 미지급).
          // 하루 10칸까지만 누적 하트에 반영(상한 10), 그 뒤엔 오늘 카운트만.
          const dayKey = Math.floor(Date.now() / 86400000)
          const sameDay = (prev.chatsDay ?? 0) === dayKey
          const count = (sameDay ? (prev.chatsToday ?? 0) : 0) + 1
          const earnsHeart = count <= 10
          const next: PetModel = {
            ...prev,
            chatsDay: dayKey,
            chatsToday: count,
            lifetime: { ...prev.lifetime, chats: (prev.lifetime.chats ?? 0) + (earnsHeart ? 1 : 0) },
          }
          if (count === 10) showBubble('오늘의 하트 10칸 만땅! 💛 수다 최고예요', 5000)
          return next
        }
        if (action === 'xp100') return settle(addXp(prev, 100))
        if (action === 'maxout') return settle(addXp(prev, MAX_XP))
        // ── 채원님 QA 테스트 버튼 ──
        if (action === 'gauge0') return { ...prev, stats: { health: 0, happiness: 0, energy: 0 } } // 게이지 0 (시무룩/지침 확인)
        if (action === 'levelup') {
          // 현재 레벨 XP 가득 → 다음 레벨. Lv.5면 환생(6,750)까지 채움
          const target = prev.stage >= MAX_LEVEL ? REBIRTH_XP : ((XP_CUMULATIVE as readonly number[])[prev.stage] ?? REBIRTH_XP)
          return settle(addXp(prev, target - prev.xp))
        }
        if (action === 'heartreset') {
          // 오늘의 하트만 0으로. 누적 하트(lifetime.chats=방꾸미기)는 유지
          const dayKey = Math.floor(Date.now() / 86400000)
          return { ...prev, chatsDay: dayKey, chatsToday: 0 }
        }
        if (action === 'addhearts') {
          // QA: 누적 하트 +50 — 방꾸미기 배경 단계 테스트용(하트 수에 맞춰 방 배경이 바뀜)
          return { ...prev, lifetime: { ...prev.lifetime, chats: (prev.lifetime.chats ?? 0) + 50 } }
        }
        if (action === 'resetfirst') {
          // 완전 초기화: 1세대 검정 고양이 Lv.1 · 게이지 70 · 누적기록/방꾸미기/도감까지 전부 리셋(이름 유지)
          return createNewPet(prev.name, 'cat', Date.now())
        }
        if (action === 'heartnext') {
          // QA 방꾸미기 테스트 — 누적 하트를 다음 해금 단계로 점프
          const thresholds = [10, 30, 60, 100, 150, 210, 280, 340, 400]
          const cur = prev.lifetime.chats ?? 0
          const next = thresholds.find((t) => t > cur) ?? 400
          return { ...prev, lifetime: { ...prev.lifetime, chats: next } }
        }
        if (action === 'sad') return { ...prev, stats: { ...prev.stats, happiness: 20 } }
        if (action === 'heal') return { ...prev, stats: { health: 100, happiness: 100, energy: 100 } }
        return prev
      })
      if (action === 'rebirth') doRebirth()
      if (action === 'resetfirst') { rebirthRef.current = false; setRebirthPrompt(false) }
      setTimeout(saveNow, 0) // QA/디버그 변경 즉시 저장 — 미니홈(2초 폴링) 반영
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!pet) return <div className="overlay" />

  const anim = isResting(Date.now()) ? 'sleep' : animationStateFor(pet)
  const reminderMed =
    reminder && reminder.kind === 'medication'
      ? configRef.current.medications.find((m) => m.id === reminder.id)
      : undefined
  const reminderDetail = reminderMed
    ? [reminderMed.dose, reminderMed.timing ? TIMING_LABEL[reminderMed.timing] : null].filter(Boolean).join(' · ')
    : ''
  const restingNow = isResting(Date.now())
  const poseNow = Date.now()
  const currentPose = pickPose(
    pet,
    {
      eatUntil: eatUntilRef.current,
      patUntil: patUntilRef.current,
      walkUntil: walkUntilRef.current,
      moving,
      facing,
      reminderKind: reminder?.kind,
      night: isNight(poseNow),
      manualDnd,
    },
    poseNow,
  )

  // 화면 경계 보정(1#7) — 상단이면 아래로, 좌우 모서리면 안쪽 정렬. 일반 말풍선·알람 둘 다 적용
  const edgeCls = (prefix: string): string => {
    const cx = position.x + petSize / 2
    const cls: string[] = []
    if (position.y < 150) cls.push(`${prefix}--below`)
    if (cx < 120) cls.push(`${prefix}--pinleft`)
    else if (cx > window.innerWidth - 120) cls.push(`${prefix}--pinright`)
    return cls.join(' ')
  }
  const bubbleCls = edgeCls('pet__bubble')
  const reminderCls = edgeCls('pet__reminder')

  return (
    <div className="overlay">
      {(manualDnd || autoNight) && <div className="dnd-badge">🔕 방해금지 (쉬는 중)</div>}
      {!hidden && (
        <div
          style={{
            position: 'absolute',
            left: position.x,
            top: position.y,
            opacity: restingNow ? petOpacity / 100 : 1,
            transition: 'opacity 0.4s ease',
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            window.petApi.showContextMenu({ dnd: manualDnd, canRebirth: isMaxed(pet) })
          }}
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            drag.current = { dx: e.clientX - position.x, dy: e.clientY - position.y }
            longPress.current = setTimeout(() => {
              drag.current = null
              window.petApi.showContextMenu({ dnd: manualDnd, canRebirth: isMaxed(pet) })
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
              { width: sizeRef.current, height: sizeRef.current },
              { width: window.innerWidth, height: window.innerHeight },
            )
            positionRef.current = next
            setPosition(next)
          }}
          onPointerUp={(e) => {
            ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
            drag.current = null
            if (longPress.current) {
              clearTimeout(longPress.current)
              longPress.current = null
            }
            anchorRef.current = { ...positionRef.current }
            targetRef.current = { ...positionRef.current }
            pauseUntilRef.current = Date.now() + 800
            saveNow()
          }}
        >
          {reminder && (
            <div className={`pet__reminder${reminderCls ? ' ' + reminderCls : ''}`} onPointerDown={(e) => e.stopPropagation()}>
              <div className="pet__reminder-text">{REMINDER_UI[reminder.kind].text(reminder.label)}</div>
              {reminderDetail && <div className="pet__reminder-detail">{reminderDetail}</div>}
              {reminderMed?.note && <div className="pet__reminder-detail">📌 {reminderMed.note}</div>}
              {reminder.kind === 'medication' && <div className="pet__reminder-guide">{MISSED_DOSE_GUIDE}</div>}
              <div className="pet__reminder-actions">
                <button className="rbtn rbtn--ok" onClick={confirmReminder}>
                  {REMINDER_UI[reminder.kind].ok}
                </button>
                <button className="rbtn" onClick={snoozeReminder}>
                  나중에
                </button>
              </div>
            </div>
          )}
          {stressAlert && !reminder && (
            <div className={`pet__reminder pet__reminder--stress${reminderCls ? ' ' + reminderCls : ''}`} onPointerDown={(e) => e.stopPropagation()}>
              <div className="pet__reminder-text">스트레스를 받고 계신 것 같아요 🥺</div>
              <div className="pet__reminder-detail">지금 스트레스를 받고 계신가요?</div>
              <div className="pet__reminder-actions">
                <button className="rbtn rbtn--ok" onClick={openRelief}>
                  예
                </button>
                <button className="rbtn" onClick={dismissNotStressed}>
                  아니요
                </button>
              </div>
            </div>
          )}
          <Pet
            bubbleClass={bubbleCls}
            creature={pet.creature}
            stage={pet.stage}
            generation={pet.generation}
            animation={anim}
            chewing={chewing}
            gauge={gauge}
            moving={moving}
            blink={blink}
            facing={facing}
            stats={pet.stats}
            bubble={reminder || stressAlert ? null : bubble}
            pose={currentPose}
          />
        </div>
      )}
      {hearts > 0 && (
        <div
          key={hearts}
          className="play-hearts"
          style={{ position: 'absolute', left: position.x + petSize / 2 - 12, top: position.y - 28 }}
        >
          💛
        </div>
      )}
      {levelUp > 0 && (
        <div
          key={`lv-${levelUp}`}
          className="levelup-fx"
          style={{ position: 'absolute', left: position.x + petSize / 2 - 46, top: position.y - 18 }}
        >
          ✨ LEVEL UP ✨
        </div>
      )}
      {rebirthPrompt && (
        <div className="invite-prompt" onPointerDown={(e) => e.stopPropagation()}>
          <div className="invite-prompt__text">
            🎓 {pet.name}이(가) 만렙(Lv.5)이 됐어요!
            <br />
            졸업하고, 새로운 모습의 아기로 환생할까요?
            <br />
            <small>세대는 {pet.generation + 1}번째로 이어지고, 함께한 기록은 남아요.</small>
          </div>
          <div className="invite-prompt__actions">
            <button className="rbtn rbtn--ok" onClick={doRebirth}>
              환생하기 🥚
            </button>
            <button className="rbtn" onClick={laterRebirth}>
              조금 이따가
            </button>
          </div>
        </div>
      )}
      {naming && (
        <div className="invite-prompt" onPointerDown={(e) => e.stopPropagation()}>
          <div className="invite-prompt__text">🐣 {pet.generation}번째 아이가 태어났어요! 이름을 지어주세요</div>
          <input
            className="name-input"
            placeholder={`이름 (예: ${pet.name || '퐁이'})`}
            value={nameInput}
            maxLength={12}
            autoFocus
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nameInput.trim()) confirmName()
            }}
          />
          <div className="invite-prompt__actions">
            <button className="rbtn rbtn--ok" disabled={!nameInput.trim()} onClick={confirmName}>
              확인
            </button>
          </div>
        </div>
      )}
      {reliefOpen && (
        <ReliefOverlay
          petImg={poseUrl(pet.creature, pet.stage, 'idle') ?? spriteUrl(pet.creature, pet.stage) ?? null}
          petName={pet.name}
          creature={pet.creature}
          stage={pet.stage}
          onComplete={completeRelief}
          onClose={closeRelief}
          onSelect={selectRelief}
          askScale={reliefRoute1}
          showChat={reliefRoute1}
          onScale={reportStressScale}
          onChat={chatRelief}
        />
      )}
    </div>
  )
}
