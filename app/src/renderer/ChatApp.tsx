// 퐁이네 미니홈 — 싸이월드 미니홈피 문법(미니룸·책갈피 탭·TODAY)을 빌린 케어퐁 허브(기본 창)
// 탭 3종: 💛 마음관리 / 📔 아카이브(도감) / ⚙️ 설정 (약 등록은 설정 안으로 · 기획서 10·11번)
// 약 등록은 LUI(대화)·GUI(폼) 두 경로 제공 + 소요시간 자동 계측 → LUI vs GUI 비교 테스트용
// 공감·약설명 응답은 규칙 기반(Wizard-of-Oz) — LLM 교체 지점: core/empathy.ts, core/drugData.ts
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CatalogItem } from '../core/catalog'
import type { DrugInfo } from '../core/drugData'
import type { Pet } from '../core/types'
import type { HealthConfig } from '../core/health'
import { DEFAULT_HEALTH_CONFIG, DEFAULT_AUX, createMed, addMed, removeMed } from '../core/health'
import { EMPTY_INTAKE, recordMed, type IntakeLog } from '../core/intake'
import { startOfLocalDay } from '../core/scheduler'
import { replyEmpathy } from '../core/empathy'
import { parseTimes, tryParseRegister, registerSummary, type ParsedTime } from '../core/medLui'
import { normalizeAncestors, xpProgress } from '../core/progression'
import { spriteUrl, poseUrl, roomBgFor } from './sprites'

type ChatMode = 'med' | 'heart' | 'settings' | 'archive'

interface ChatMessage {
  id: number
  role: 'user' | 'pet'
  text: string
  card?: DrugInfo
  thinking?: boolean
  crisis?: boolean
  suggestRelief?: boolean
  actions?: { label: string; action: QuickAction }[] // 말풍선 안 선택 버튼
  form?: boolean // 말풍선 안 GUI 등록 폼
}

type QuickAction = 'reg' | 'ask' | 'reg-lui' | 'reg-gui' | 'home'

type Wizard = null | { step: 'name' } | { step: 'time'; name: string }

// ── LUI vs GUI 등록 비교 테스트 계측 (docs/테스트설계 문서 참조) ──
interface RegLog {
  method: 'lui' | 'gui'
  ms: number
  at: number
}
const REG_KEY = 'carepong-regtest'
const loadRegLogs = (): RegLog[] => {
  try {
    return JSON.parse(localStorage.getItem(REG_KEY) ?? '[]') as RegLog[]
  } catch {
    return []
  }
}
const appendRegLog = (entry: RegLog): RegLog[] => {
  const next = [...loadRegLogs(), entry]
  localStorage.setItem(REG_KEY, JSON.stringify(next))
  return next
}

const WELCOME: Record<'med' | 'heart', string> = {
  med: '약에 대한 궁금한 건 모두 물어보세요! 💊',
  heart: '집사님, 오늘은 어떤 힘든 일이 있으셨나요? 저랑 같이 이야기해봐요! 💛',
}
const MED_ENTRY_ACTIONS: { label: string; action: QuickAction }[] = [
  { label: '💊 약 등록', action: 'reg' },
  { label: '🔍 약 물어보기', action: 'ask' },
]
const HOME_ACTION: { label: string; action: QuickAction } = { label: '↩️ 처음으로', action: 'home' }
const REG_HOW_ACTIONS: { label: string; action: QuickAction }[] = [
  { label: '💬 말로 등록할래', action: 'reg-lui' },
  { label: '📝 버튼으로 등록할래', action: 'reg-gui' },
  HOME_ACTION,
]

// ── 마음 일기장 — 날짜별 기분·남긴 말 저장 (요약은 규칙 기반, LLM 교체 지점: summarizeDay) ──
interface DiaryEntry {
  mood?: string // 이모지
  moodLabel?: string
  notes: string[] // 마음관리에서 남긴 말 (하루 최대 8개, 각 80자)
}
const DIARY_KEY = 'carepong-diary'
const loadDiary = (): Record<string, DiaryEntry> => {
  try {
    return JSON.parse(localStorage.getItem(DIARY_KEY) ?? '{}') as Record<string, DiaryEntry>
  } catch {
    return {}
  }
}
const dayKeyOf = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// 두세 줄 요약 — 규칙 기반(Wizard-of-Oz). LLM 연동 시 이 함수만 교체하면 된다.
const summarizeDay = (e: DiaryEntry): string[] => {
  const lines: string[] = []
  if (e.mood) lines.push(`기분 ${e.mood} ${e.moodLabel ?? ''}`.trim())
  const cut = (t: string): string => (t.length > 44 ? t.slice(0, 44) + '…' : t)
  if (e.notes.length > 0) lines.push(`“${cut(e.notes[0])}”`)
  if (e.notes.length > 1) lines.push(`“${cut(e.notes[e.notes.length - 1])}”`)
  if (lines.length === 0) lines.push('이날은 조용히 지나갔어요')
  return lines.slice(0, 3)
}

const MOODS = [
  { emoji: '😄', label: '최고예요', reply: '와, 오늘 기분 최고라니 저까지 신나요! 이런 날은 오래 기억해둬요 💛', relief: false },
  { emoji: '🙂', label: '좋아요', reply: '좋은 하루라니 다행이에요. 남은 시간도 가볍게 흘러가길!', relief: false },
  { emoji: '😐', label: '그냥 그래요', reply: '무난한 날도 소중해요. 혹시 마음에 걸리는 게 있으면 꺼내놓아도 돼요.', relief: false },
  { emoji: '😞', label: '지쳤어요', reply: '많이 지치셨군요… 오늘 버텨낸 것만으로 충분해요. 잠깐 저랑 쉬어갈까요?', relief: true },
  { emoji: '😣', label: '힘들어요', reply: '힘든 하루였군요. 혼자 참지 않으셔도 돼요, 제가 옆에 있을게요. 숨 한 번 같이 고를까요?', relief: true },
]

function TypeText({ text }: { text: string }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    setShown(0)
    const iv = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(iv)
          return n
        }
        return n + 1
      })
    }, 20)
    return () => clearInterval(iv)
  }, [text])
  return <>{text.slice(0, shown)}</>
}

function DrugCard({ card }: { card: DrugInfo }) {
  return (
    <div className="drug-card">
      <p className="drug-card__name">{card.name}</p>
      <p className="drug-card__company">{card.company}</p>
      <dl>
        {(
          [
            ['효능', card.efficacy, false],
            ['복용법', card.usage, false],
            ['주의', card.caution, true],
          ] as const
        ).map(([label, value, warn]) => (
          <div key={label} className="drug-card__row">
            <dt className={`drug-card__tag${warn ? ' drug-card__tag--warn' : ''}`}>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function MiniBar({ icon, value, color, title }: { icon: string; value: number; color: string; title: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <span className="mh__minibar" data-tip={title}>
      <i>{icon}</i>
      <b>
        <u style={{ width: `${pct}%`, background: color }} />
      </b>
    </span>
  )
}

export default function ChatApp() {
  const initialMode = (new URLSearchParams(location.search).get('mode') as ChatMode) || 'heart'
  const [mode, setMode] = useState<ChatMode>(initialMode)
  const [feeds, setFeeds] = useState<Record<'med' | 'heart', ChatMessage[]>>({
    med: [{ id: 1, role: 'pet', text: WELCOME.med, actions: MED_ENTRY_ACTIONS }],
    heart: [{ id: 2, role: 'pet', text: WELCOME.heart }],
  })
  const [input, setInput] = useState('')
  const [pet, setPet] = useState<Pet | null>(null)
  const [config, setConfig] = useState<HealthConfig>(DEFAULT_HEALTH_CONFIG)
  const [intake, setIntake] = useState<IntakeLog>(EMPTY_INTAKE)
  const [wizard, setWizard] = useState<Wizard>(null)
  const [mood, setMood] = useState<string | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [demoOn, setDemoOn] = useState(false)
  const [gName, setGName] = useState('')
  const [gTimes, setGTimes] = useState<string[]>(['09:00'])
  const [regLogs, setRegLogs] = useState<RegLog[]>(loadRegLogs())
  const [localHearts, setLocalHearts] = useState(0) // 저장소 폴링(2초) 사이 즉시 반영용
  const [diary, setDiary] = useState<Record<string, DiaryEntry>>(loadDiary())
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [petPage, setPetPage] = useState(0)
  const [diaryPage, setDiaryPage] = useState(0)
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [selectedProduct, setSelectedProduct] = useState<CatalogItem | null>(null)
  const [searchStatus, setSearchStatus] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const [sName, setSName] = useState('') // 설정 탭 약 등록 폼
  const [sTimes, setSTimes] = useState<string[]>(['09:00'])
  const nextId = useRef(3)
  const feedRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const luiStartRef = useRef<number | null>(null)
  const guiStartRef = useRef<number | null>(null)

  // 집주인(내 펫)·복약 데이터 동기화
  useEffect(() => {
    const sync = (): void => {
      window.petApi.load().then((s) => {
        if (s?.pet) {
          setPet(s.pet)
          document.title = `${s.pet.name}의 미니홈`
        }
      })
      window.petApi.loadConfig().then(setConfig)
      window.petApi.loadIntake().then((l) => setIntake({ ...EMPTY_INTAKE, ...l }))
    }
    sync()
    const id = setInterval(sync, 2000)
    return () => clearInterval(id)
  }, [])

  // 이 창의 타이핑·클릭도 디지털 마커로 수집 (내용 미저장 — 타이밍·횟수만)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void =>
      window.careApi.stressEvent({ type: 'key', backspace: e.key === 'Backspace' })
    const onClick = (): void => window.careApi.stressEvent({ type: 'click' })
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    const offMode = window.careApi.onChatMode((m) => setMode(m))
    const offStress = window.careApi.onStress((s) => setDemoOn(s.demo))
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
      offMode()
      offStress()
    }
  }, [])

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' })
  }, [feeds, mode])

  const push = (m: Omit<ChatMessage, 'id'>): number => {
    const id = nextId.current++
    const t = modeRef.current === 'heart' ? 'heart' : 'med'
    setFeeds((prev) => ({ ...prev, [t]: [...prev[t], { ...m, id }] }))
    return id
  }
  const resolveThinking = (thinkingId: number, reply: Omit<ChatMessage, 'id'>, delayFrom: number): void => {
    const wait = Math.max(0, 900 - (Date.now() - delayFrom))
    const t = modeRef.current === 'heart' ? 'heart' : 'med'
    setTimeout(() => {
      setFeeds((prev) => ({
        ...prev,
        [t]: prev[t].map((m) => (m.id === thinkingId ? { ...m, ...reply, thinking: false } : m)),
      }))
    }, wait)
  }

  const todayKey = Math.floor(Date.now() / 86400000)
  const heartsToday = Math.min(
    10,
    Math.max((pet?.chatsDay ?? 0) === todayKey ? (pet?.chatsToday ?? 0) : 0, localHearts),
  )
  const sendChatPing = (): void => {
    window.petApi.debug('chat')
    setLocalHearts((h) => Math.min(10, Math.max(h, heartsToday) + 1))
  }
  const lifetimeChats = pet?.lifetime.chats ?? 0 // = 누적 하트 (방꾸미기 진척)
  // 방꾸미기 단계 — 누적 하트 임계 (기획서 8번)
  const ROOM_STAGES = [
    { hearts: 10, item: '벽지' },
    { hearts: 30, item: '바닥면' },
    { hearts: 60, item: '러그' },
    { hearts: 100, item: '침대' },
    { hearts: 150, item: '사진(탁상)' },
    { hearts: 210, item: '옷장' },
    { hearts: 280, item: '시계벽걸이' },
    { hearts: 340, item: '티비' },
    { hearts: 400, item: '장난감' },
  ]
  const roomStage = ROOM_STAGES.filter((s) => lifetimeChats >= s.hearts).length
  const nextRoom = ROOM_STAGES[roomStage]

  const PETS_PER_PAGE = 6 // 3칸 × 2줄
  const DIARY_PER_PAGE = 5
  const diaryDays = Object.keys(diary).sort().reverse()
  const petCells = [
    ...(pet
      ? [{ key: 'now', url: poseUrl(pet.creature, pet.stage, 'idle') ?? spriteUrl(pet.creature, pet.stage), name: pet.name, now: true }]
      : []),
    ...normalizeAncestors(pet?.ancestors)
      .slice()
      .reverse()
      .map((a, i) => ({ key: `${a.creature}-${i}`, url: poseUrl(a.creature, 5, 'idle') ?? spriteUrl(a.creature, 5), name: a.name, now: false })),
  ]

  const recordDiary = (patch: { mood?: string; moodLabel?: string; note?: string }): void => {
    setDiary((prev) => {
      const key = dayKeyOf(Date.now())
      const cur: DiaryEntry = prev[key] ?? { notes: [] }
      const next: DiaryEntry = {
        mood: patch.mood ?? cur.mood,
        moodLabel: patch.moodLabel ?? cur.moodLabel,
        notes: patch.note ? [...cur.notes, patch.note.slice(0, 80)].slice(-8) : cur.notes,
      }
      const all = { ...prev, [key]: next }
      localStorage.setItem(DIARY_KEY, JSON.stringify(all))
      return all
    })
  }

  useEffect(() => {
    let active = true
    setCatalogItems([])
    if (!sName.trim() || selectedProduct) { setSearchStatus(''); return }
    setSearchStatus('검색 중…')
    const timer = setTimeout(() => {
      window.careApi.searchDrug(sName).then((result) => {
        if (!active) return
        setCatalogItems(result.items)
        setSearchStatus(result.error ?? (result.items.length ? '후보를 선택해주세요.' : '검색 결과가 없어요. 이름을 바꿔 검색해주세요.'))
      }).catch(() => { if (active) setSearchStatus('검색에 실패했어요. 다시 시도해주세요.') })
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [sName, selectedProduct, searchRevision])

  // ── 약지도: 오늘의 복약 체크 ──
  const takenToday = (medId: string): boolean =>
    (intake.medsTakenAt[medId] ?? 0) >= startOfLocalDay(Date.now())
  const checkMed = (medId: string, name: string): void => {
    const next = recordMed(intake, medId, Date.now())
    setIntake(next)
    window.petApi.saveIntake(next)
    push({ role: 'pet', text: `${name} 복용 체크! ✅ 잘 챙기셨어요. 오늘도 제가 곁에서 응원할게요.` })
  }

  // ── 약 등록 (LUI·GUI 공용) ──
  const registerMed = (name: string, times: ParsedTime[], product?: CatalogItem): void => {
    const med = createMed(
      crypto.randomUUID(),
      name,
      product?.item_type === 'HFF',
      times.map((t) => t.time),
      [],
      { timing: times[0]?.timing },
    )
    if (product) Object.assign(med, {
      item_type: product.item_type, product_id: product.product_id,
      external_id: product.external_id, manufacturer_name: product.manufacturer_name,
    })
    window.petApi.saveConfig(addMed(config, med))
    setConfig((c) => addMed(c, med))
  }
  const logReg = (method: 'lui' | 'gui', startedAt: number | null): void => {
    if (startedAt == null) return
    setRegLogs(appendRegLog({ method, ms: Date.now() - startedAt, at: Date.now() }))
  }

  const handleMedMessage = (text: string, thinkingId: number, started: number): void => {
    if (wizard || tryParseRegister(text)) {
      setWizard(null)
      setMode('settings')
      resolveThinking(thinkingId, { role: 'pet', text: '설정 탭에서 제품을 검색하고 후보를 선택해 등록해주세요.' }, started)
      return
    }
    if (/오늘/.test(text) && /약|복약/.test(text)) {
      const lines = config.medications.map(
        (m) => `· ${m.name} ${m.times.join(', ')} ${takenToday(m.id) ? '✅ 완료' : '⬜ 아직'}`,
      )
      resolveThinking(
        thinkingId,
        {
          role: 'pet',
          text:
            lines.length > 0 ? `오늘의 복약이에요!\n${lines.join('\n')}` : '아직 등록된 약이 없어요. 아래에서 등록해보세요!',
          actions: MED_ENTRY_ACTIONS,
        },
        started,
      )
      return
    }
    window.careApi
      .searchDrug(text)
      .then((res) => {
        if (res.error) {
          resolveThinking(thinkingId, { role: 'pet', text: res.error }, started)
        } else if (res.items.length > 0) {
          const item = res.items[0]
          resolveThinking(thinkingId, { role: 'pet', text: `${item.product_name} · ${item.manufacturer_name ?? ''}\n등록은 설정 탭에서 검색 후보를 선택해주세요.` }, started)
        } else {
          resolveThinking(
            thinkingId,
            { role: 'pet', text: '으음, 그 약은 아직 못 찾았어요… 정확한 약 이름으로 다시 물어봐 주실래요?' },
            started,
          )
        }
      })
      .catch(() =>
        resolveThinking(thinkingId, { role: 'pet', text: '앗, 지금 정보를 가져오는 데 문제가 생겼어요. 잠시 후 다시 시도해 주세요!' }, started),
      )
  }

  const send = (e: FormEvent): void => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    push({ role: 'user', text })
    sendChatPing() // 대화 하트 +1 (하루 10칸, 다 채우면 보너스)
    const thinkingId = push({ role: 'pet', text: '', thinking: true })
    const started = Date.now()
    if (mode === 'med') {
      handleMedMessage(text, thinkingId, started)
    } else {
      recordDiary({ note: text }) // 마음 일기장에 남김
      const r = replyEmpathy(text) // ← LLM 교체 지점
      // 공감챗봇 메시지 (호출위치표 D) — 원문 저장 X, 길이·키워드 적중 여부만
      window.careApi.logEvent?.('chat_message', 'M05', { len: text.length, keyword_hit: !!(r.crisis || r.suggestRelief) })
      resolveThinking(thinkingId, { role: 'pet', text: r.text, crisis: r.crisis, suggestRelief: r.suggestRelief }, started)
    }
  }

  // 말풍선 버튼(퀵 액션) 처리 — 누른 메시지의 버튼은 제거해 재클릭 방지
  const stripActions = (msgId: number): void => {
    setFeeds((prev) => ({
      ...prev,
      med: prev.med.map((m) => (m.id === msgId ? { ...m, actions: undefined } : m)),
    }))
  }
  const handleAction = (msgId: number, action: QuickAction): void => {
    stripActions(msgId)
    setWizard(null)
    if (action === 'reg' || action === 'reg-lui' || action === 'reg-gui') {
      setMode('settings')
    } else if (action === 'ask') {
      push({ role: 'pet', text: '제품명을 입력하면 검색 후보를 확인할 수 있어요. 등록은 설정 탭에서 진행해주세요.', actions: [HOME_ACTION] })
    } else {
      push({ role: 'pet', text: '무엇을 도와드릴까요?', actions: MED_ENTRY_ACTIONS })
    }
  }

  const submitGui = (formMsgId: number): void => {
    if (!gName.trim()) return
    registerMed(
      gName.trim(),
      gTimes.map((t) => ({ time: t, label: t })),
    )
    logReg('gui', guiStartRef.current)
    guiStartRef.current = null
    // 제출한 폼은 닫고 확인 메시지
    setFeeds((prev) => ({
      ...prev,
      med: prev.med.map((m) => (m.id === formMsgId ? { ...m, form: undefined } : m)),
    }))
    push({ role: 'pet', text: `${gName.trim()}, ${gTimes.join(', ')} · 매일로 등록했어요! 💊 시간이 되면 바탕화면에서 챙겨드릴게요.`, actions: MED_ENTRY_ACTIONS })
    setGName('')
    setGTimes(['09:00'])
  }

  const pickMood = (m: (typeof MOODS)[number]): void => {
    setMood(m.emoji)
    recordDiary({ mood: m.emoji, moodLabel: m.label })
    window.careApi.logEvent?.('mood_checked', 'M05', { mood: m.emoji })
    sendChatPing()
    push({ role: 'user', text: `오늘 기분: ${m.emoji} ${m.label}` })
    const id = push({ role: 'pet', text: '', thinking: true })
    resolveThinking(id, { role: 'pet', text: m.reply, suggestRelief: m.relief }, Date.now() - 400)
  }

  // ── 설정 저장 헬퍼 ──
  const persist = (next: HealthConfig): void => {
    setConfig(next)
    window.petApi.saveConfig(next)
  }
  const aux = config.aux ?? DEFAULT_AUX
  const avg = (method: 'lui' | 'gui'): number | null => {
    const arr = regLogs.filter((r) => r.method === method)
    if (arr.length === 0) return null
    return Math.round(arr.reduce((s, r) => s + r.ms, 0) / arr.length / 100) / 10
  }

  const petName = pet?.name ?? '퐁이'
  const petImg = pet ? (poseUrl(pet.creature, pet.stage, 'idle') ?? spriteUrl(pet.creature, pet.stage)) : undefined
  const roomBg = roomBgFor(lifetimeChats)
  const chatMode = mode === 'heart' ? 'heart' : 'med'
  const messages = feeds[chatMode]

  return (
    <div className={`mh mh--${mode}`}>
      <header className="mh__bar">
        <span className="mh__title">
          {petName}
          <small>의 미니홈</small>
        </span>
        <button className="mh__help" onClick={() => setGuideOpen((v) => !v)} title="이 게임 설명 보기">
          ?
        </button>
      </header>

      <div className="mh__frame">
        {guideOpen && (
          <div className="mh__guide" role="dialog" aria-label="키우기 공략집">
            <div className="mh__guide-head">
              📖 케어퐁 공략집
              <button onClick={() => setGuideOpen(false)} aria-label="닫기">✕</button>
            </div>

            <p className="mh__guide-sec">🫧 케어퐁은 어떤 펫?</p>
            <p className="mh__guide-note">
              키보드와 마우스의 리듬을 느끼고, 집사님이 스트레스 받는 순간을 바로 알아차리는 펫이에요.<br />
              힘들어 보이면 먼저 다가가서 물어보고, 1분 심호흡이나 명상으로 같이 쉬어가요.<br />
              <b>무슨 내용을 쓰는지는 절대 보지 않아요.</b> 리듬과 횟수만 느낄 뿐!
            </p>

            <p className="mh__guide-sec">📊 게이지, 뭘 하면 오를까?</p>
            <table className="mh__guide-table">
              <tbody>
                <tr><th>🩷 행복</th><td>쓰다듬기 <b>+12</b> · 산책 <b>+8</b> · 대화/기분 체크 <b>+1</b></td></tr>
                <tr><th>💪 건강</th><td>산책 <b>+10</b> · 밥 <b>+8</b> · 물 <b>+5</b> · 스트레칭 <b>+5</b></td></tr>
                <tr><th>⚡ 기력</th><td>밥 <b>+12</b> · 약 챙기기 <b>+10</b> · 휴식 <b>+5</b> · 밤엔 자면서 회복</td></tr>
              </tbody>
            </table>
            <p className="mh__guide-note">방치하면 조금씩 내려가요.<br />그래도 0이 되면? 시무룩해질 뿐, 절대 죽지 않아요!</p>

            <p className="mh__guide-sec">⭐ 레벨업 지름길</p>
            <table className="mh__guide-table">
              <tbody>
                <tr><th>산책 · 쉬어가기</th><td><b>+15</b> · 효율 1등!</td></tr>
                <tr><th>밥 · 쓰다듬기 · 약</th><td><b>+10</b></td></tr>
                <tr><th>물 · 스트레칭 · 휴식</th><td><b>+5</b></td></tr>
                <tr><th>대화 · 기분 체크</th><td>XP 없음 — <b>하트</b>만 (방꾸미기 전용)</td></tr>
              </tbody>
            </table>
            <p className="mh__guide-note">※ 각 행동은 하루 3번까지만 XP가 올라요. 대화는 XP가 아니라 하트를 모아요.</p>

            <p className="mh__guide-sec">🗓 하루를 이렇게 보내면 딱!</p>
            <ol className="mh__guide-steps">
              <li><b>아침</b><br />약·물 알람에 [먹었어요]로 하루 시작!</li>
              <li><b>업무 중</b><br />케어펫이 힘드냐고 물어오면 [예]!<br />딱 1분 쉬면 스트레스가 쭉 내려가요</li>
              <li><b>틈틈이</b><br />미니홈에서 수다 떨기. 하루 10칸까지 하트!</li>
              <li><b>하루 마무리</b><br />밥 주고, 쓰다듬고, 산책까지. 오늘 퀘스트 클리어!</li>
            </ol>

            <p className="mh__guide-sec">🏠 수다로 방 꾸미기 (누적 하트)</p>
            <table className="mh__guide-table">
              <tbody>
                {ROOM_STAGES.map((s) => (
                  <tr key={s.hearts}>
                    <th>하트 {s.hearts}</th>
                    <td>{lifetimeChats >= s.hearts ? '✅' : '🔒'} {s.item}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mh__guide-note">
              지금까지 모은 하트 {lifetimeChats}개 · 방꾸미기 {roomStage}/9단계
              {nextRoom ? ` · 다음 "${nextRoom.item}"까지 ${nextRoom.hearts - lifetimeChats}하트` : ' · 풀세트 완성! 🎉'}
              <br />하트는 게이지·XP와 무관해요.
            </p>

            <p className="mh__guide-sec">🥚 만렙이 되면?</p>
            <p className="mh__guide-note">
              졸업하고 <b>새 모습의 아기로 환생</b>! 세대가 +1 돼요.<br />먼저 살던 아이는 이 집에 남아서 계속 같이 살아요.
            </p>
          </div>
        )}
        {/* 미니룸 — 가구: 창문·액자·시계·책장·침대·화분·스탠드 */}
        <div className="mh__room">
          {/* 방꾸미기 — 누적 하트 단계별 전체 방 배경 이미지 (0=빈방) */}
          {roomBg && <img className="mh__room-bg" src={roomBg} alt="" draggable={false} />}
          {/* 먼저 살던 아이들 — 환생해도 집에 작게 남는다 */}
          {normalizeAncestors(pet?.ancestors).slice(-2).map((a, i) => {
            const url = poseUrl(a.creature, 5, 'idle') ?? spriteUrl(a.creature, 5)
            return url ? (
              <img
                key={`${a.creature}-${i}`}
                className={`mh__ancestor mh__ancestor--${i}`}
                src={url}
                alt={a.name}
                title={`${a.name} — 먼저 살던 아이예요`}
                draggable={false}
              />
            ) : null
          })}
          <div className="mh__petspot">
            <span className={`mh__rug${lifetimeChats >= 100 ? ' mh__rug--deluxe' : ''}`} />
            {petImg ? (
              <img className="mh__pet" src={petImg} alt={petName} draggable={false} />
            ) : (
              <span className="mh__pet-fallback">🐱</span>
            )}
          </div>
          <div className="mh__plate">
            {petName} <small>Lv.{pet?.stage ?? 1} · {pet?.generation ?? 1}번째 아이</small>
          </div>
        </div>
        <div className="mh__room-stage">
          🏠 방꾸미기 {roomStage}/9
          {nextRoom ? ` · 다음 ${nextRoom.item}까지 ${nextRoom.hearts - lifetimeChats}하트` : ' · 완성 🎉'}
        </div>

        {/* 상태 바 — 행복·건강·기력·XP 상시 표시 */}
        {pet && (
          <div className="mh__stats">
            <MiniBar icon="🩷" value={pet.stats.happiness} color="#ff6b8a" title={`행복 ${Math.round(pet.stats.happiness)}\n쓰다듬기·산책·수다로 쑥쑥!`} />
            <MiniBar icon="💪" value={pet.stats.health} color="#5ec27a" title={`건강 ${Math.round(pet.stats.health)}\n밥·산책·물·스트레칭!`} />
            <MiniBar icon="⚡" value={pet.stats.energy} color="#f2b441" title={`기력 ${Math.round(pet.stats.energy)}\n밥과 약, 휴식으로 충전!`} />
            <MiniBar
              icon="⭐"
              value={pet.stage >= 5 ? 100 : xpProgress(pet).pct}
              color="#b9aee8"
              title={pet.stage >= 5 ? '만렙! 이제 환생할 수 있어요' : `XP ${xpProgress(pet).into}/${xpProgress(pet).needed}\n돌보고 수다 떨면 쑥쑥!`}
            />
          </div>
        )}

        {/* 오늘의 하트 — 대화할수록 한 칸씩! 10칸이면 보너스 */}
        {pet && (
          <div
            className="mh__hearts"
            data-tip={heartsToday >= 10 ? '오늘 하트 만땅! 보너스 받았어요' : `오늘 나눈 대화 ${heartsToday}/10\n다 채우면 보너스 XP!`}
          >
            <span className="mh__hearts-label">오늘의 하트</span>
            <span className="mh__hearts-row">
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} className={i < heartsToday ? 'on' : ''}>
                  {i < heartsToday ? '💛' : '🤍'}
                </i>
              ))}
            </span>
          </div>
        )}

        <div className="mh__body">
          <div className="mh__content">
            {mode === 'med' && (
              <>
                <div className="mh__card">
                  <div className="mh__card-head">
                    오늘의 복약
                    {config.medications.length > 0 && (
                      <span className="mh__card-sub">
                        {config.medications.filter((m) => takenToday(m.id)).length}/{config.medications.length} 완료
                      </span>
                    )}
                  </div>
                  {config.medications.length === 0 ? (
                    <p className="mh__empty">등록된 약이 없어요 — 아래 대화에서 [💊 약 등록]을 눌러보세요!</p>
                  ) : (
                    <ul className="mh__meds">
                      {config.medications.map((m) => (
                        <li key={m.id} className={takenToday(m.id) ? 'done' : ''}>
                          <span className="mh__med-name">
                            💊 {m.name} <small>{m.times.join(', ')}</small>
                          </span>
                          {takenToday(m.id) ? (
                            <span className="mh__med-done">✅</span>
                          ) : (
                            <button className="mh__med-btn" onClick={() => checkMed(m.id, m.name)}>
                              먹었어요
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {mode === 'heart' && (
              <>
                {!mood && (
                <div className="mh__card">
                  <div className="mh__card-head">오늘 기분 어때요?</div>
                  <div className="mh__moods">
                    {MOODS.map((m) => (
                      <button
                        key={m.emoji}
                        className={`mh__mood${mood === m.emoji ? ' mh__mood--on' : ''}`}
                        title={m.label}
                        onClick={() => pickMood(m)}
                      >
                        {m.emoji}
                      </button>
                    ))}
                  </div>
                </div>
                )}
                <div className="mh__chips">
                  <button className="mh__chip" onClick={() => window.careApi.openRelief()}>🫧 1분 쉬어가기</button>
                </div>
              </>
            )}

            {mode === 'med' || mode === 'heart' ? (
              <>
                <div ref={feedRef} className="mh__feed">
                  {messages.map((m) =>
                    m.role === 'user' ? (
                      <div key={m.id} className="msg msg--user">
                        <p>{m.text}</p>
                      </div>
                    ) : (
                      <div key={m.id} className="msg msg--pet">
                        {petImg ? (
                          <img className="msg__avatar-img" src={petImg} alt="" aria-hidden draggable={false} />
                        ) : (
                          <span className="msg__avatar" aria-hidden>🐱</span>
                        )}
                        <div className={`msg__bubble${m.crisis ? ' msg__bubble--crisis' : ''}`}>
                          {m.thinking ? (
                            <span className="thinking" aria-label={`${petName}이 생각하는 중`}>
                              <i /><i /><i />
                            </span>
                          ) : (
                            <TypeText text={m.text} />
                          )}
                          {m.card && <DrugCard card={m.card} />}
                          {m.suggestRelief && !m.thinking && (
                            <button className="msg__relief" onClick={() => window.careApi.openRelief()}>
                              🫧 1분 쉬어가기 (심호흡·명상)
                            </button>
                          )}
                          {m.actions && !m.thinking && (
                            <div className="msg__actions">
                              {m.actions.map((a) => (
                                <button key={a.action} onClick={() => handleAction(m.id, a.action)}>
                                  {a.label}
                                </button>
                              ))}
                            </div>
                          )}
                          {m.form && !m.thinking && (
                            <div className="mh__guiform mh__guiform--inmsg">
                              <input
                                className="mh__ginput"
                                placeholder="약/영양제 이름"
                                value={gName}
                                onChange={(e) => setGName(e.target.value)}
                              />
                              <div className="mh__gtimes">
                                {gTimes.map((t, i) => (
                                  <span key={i} className="mh__gtime">
                                    <input
                                      type="time"
                                      value={t}
                                      onChange={(e) =>
                                        setGTimes((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))
                                      }
                                    />
                                    {gTimes.length > 1 && (
                                      <button onClick={() => setGTimes((prev) => prev.filter((_, idx) => idx !== i))}>−</button>
                                    )}
                                  </span>
                                ))}
                                <button className="mh__gadd" onClick={() => setGTimes((prev) => [...prev, '13:00'])}>
                                  + 시간
                                </button>
                              </div>
                              <button className="mh__gsubmit" onClick={() => submitGui(m.id)}>
                                등록
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ),
                  )}
                </div>

                <form className="mh__form" onSubmit={send}>
                  <div className="mh__inputrow">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={
                        mode === 'med'
                          ? wizard
                            ? wizard.step === 'name'
                              ? '약 이름을 알려주세요'
                              : '언제 챙길까요? (예: 아침, 21:30)'
                            : '약 이름 질문 · "유산균 아침 등록"'
                          : `${petName}에게 오늘 이야기를 들려주세요`
                      }
                      aria-label={`${petName}에게 말하기`}
                    />
                    <button type="submit">보내기</button>
                  </div>
                  <p className="mh__disclaimer">
                    {mode === 'med'
                      ? '의약품 정보는 참고용이에요. 약은 처방·약사 지시가 우선이에요.'
                      : `${petName}는 상담사·의사가 아니라 곁을 지키는 친구예요. 많이 힘들 땐 자살예방상담 109.`}
                  </p>
                </form>
              </>
            ) : mode === 'archive' ? (
              /* ── 📔 아카이브 — 역대 펫 + 마음 일기장 ── */
              <div className="mh__settings">
                <div className="mh__card">
                  <div className="mh__card-head">
                    🐾 역대 펫
                    {petCells.length > PETS_PER_PAGE && (
                      <span className="mh__pets-nav">
                        <button
                          disabled={petPage === 0}
                          onClick={() => setPetPage((n) => Math.max(0, n - 1))}
                          aria-label="이전"
                        >
                          ◀
                        </button>
                        <button
                          disabled={(petPage + 1) * PETS_PER_PAGE >= petCells.length}
                          onClick={() => setPetPage((n) => n + 1)}
                          aria-label="다음"
                        >
                          ▶
                        </button>
                      </span>
                    )}
                  </div>
                  <div className="mh__petsrow">
                    {petCells.slice(petPage * PETS_PER_PAGE, (petPage + 1) * PETS_PER_PAGE).map((cell) => (
                      <div key={cell.key} className={`mh__petcell${cell.now ? ' mh__petcell--now' : ''}`}>
                        {cell.url && <img src={cell.url} alt={cell.name} draggable={false} />}
                        <small>{cell.name}</small>
                      </div>
                    ))}
                  </div>
                  {petCells.length <= 1 && (
                    <p className="mh__empty">아직 첫 아이와 함께예요. 만렙이 되면 여기에 기록이 쌓여요!</p>
                  )}
                </div>

                <div className="mh__card">
                  <div className="mh__card-head">
                    📔 마음 일기장
                    {diaryDays.length > DIARY_PER_PAGE && (
                      <span className="mh__pets-nav">
                        <button
                          disabled={diaryPage === 0}
                          onClick={() => {
                            setDiaryPage((n) => Math.max(0, n - 1))
                            setExpandedDay(null)
                          }}
                          aria-label="이전"
                        >
                          ◀
                        </button>
                        <button
                          disabled={(diaryPage + 1) * DIARY_PER_PAGE >= diaryDays.length}
                          onClick={() => {
                            setDiaryPage((n) => n + 1)
                            setExpandedDay(null)
                          }}
                          aria-label="다음"
                        >
                          ▶
                        </button>
                      </span>
                    )}
                  </div>
                  {diaryDays.length === 0 ? (
                    <p className="mh__empty">마음관리에서 기분을 고르거나 이야기를 나누면 하루하루 일기가 쌓여요.</p>
                  ) : (
                    <ul className="mh__diary">
                      {diaryDays
                        .slice(diaryPage * DIARY_PER_PAGE, (diaryPage + 1) * DIARY_PER_PAGE)
                        .map((day) => {
                          const e = diary[day]
                          const open = expandedDay === day
                          return (
                            <li key={day} className={open ? 'open' : ''}>
                              <button className="mh__diary-row" onClick={() => setExpandedDay(open ? null : day)}>
                                <span className="mh__diary-date">{day.slice(5).replace('-', '/')}</span>
                                <span className="mh__diary-mood">{e.mood ?? '·'}</span>
                                <span className="mh__diary-peek">
                                  {e.notes[0] ? (e.notes[0].length > 16 ? e.notes[0].slice(0, 16) + '…' : e.notes[0]) : e.moodLabel ?? ''}
                                </span>
                                <span className="mh__diary-arrow">{open ? '▴' : '▾'}</span>
                              </button>
                              {open && (
                                <div className="mh__diary-summary">
                                  {summarizeDay(e).map((line, i) => (
                                    <p key={i}>{line}</p>
                                  ))}
                                </div>
                              )}
                            </li>
                          )
                        })}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              /* ── ⚙️ 설정 탭 (별도 창 없음 — 미니홈에 통합) ── */
              <div className="mh__settings">
                <div className="mh__card">
                  <div className="mh__card-head">알람 간격</div>
                  <label className="mh__row">
                    물 목표(컵)
                    <input
                      type="number" min={1} max={20}
                      value={config.water.dailyTargetCups}
                      onChange={(e) => persist({ ...config, water: { ...config.water, dailyTargetCups: Number(e.target.value) } })}
                    />
                  </label>
                  <label className="mh__row">
                    물 알림(분, 최소 20)
                    <input
                      type="number" min={20} max={240} step={10}
                      value={config.water.intervalMinutes}
                      onChange={(e) =>
                        persist({ ...config, water: { ...config.water, intervalMinutes: Math.max(20, Number(e.target.value)) } })
                      }
                    />
                  </label>
                  {/* 스트레칭·휴식은 건강 펫의 기본 — 끌 수 없고 간격만 조절 */}
                  <label className="mh__row">
                    스트레칭 간격(분)
                    <input
                      type="number" min={10} max={360} step={10}
                      value={Math.max(10, aux.stretchMin)}
                      onChange={(e) => persist({ ...config, aux: { ...aux, stretchMin: Math.max(10, Number(e.target.value)) } })}
                    />
                  </label>
                  <label className="mh__row">
                    휴식 간격(분)
                    <input
                      type="number" min={10} max={240} step={5}
                      value={Math.max(10, aux.restMin)}
                      onChange={(e) => persist({ ...config, aux: { ...aux, restMin: Math.max(10, Number(e.target.value)) } })}
                    />
                  </label>
                </div>

                <div className="mh__card">
                  <div className="mh__card-head">방해금지 · 펫</div>
                  <label className="mh__row">
                    방해금지 시간 사용
                    <input
                      type="checkbox"
                      checked={config.quietEnabled !== false}
                      onChange={(e) => persist({ ...config, quietEnabled: e.target.checked })}
                    />
                  </label>
                  {config.quietEnabled !== false && (
                    <>
                      <label className="mh__row">
                        시작 시간
                        <input type="time" value={config.quietHours.start}
                          onChange={(e) => persist({ ...config, quietHours: { ...config.quietHours, start: e.target.value } })} />
                      </label>
                      <label className="mh__row">
                        끝나는 시간
                        <input type="time" value={config.quietHours.end}
                          onChange={(e) => persist({ ...config, quietHours: { ...config.quietHours, end: e.target.value } })} />
                      </label>
                    </>
                  )}
                  <label className="mh__row">
                    케어펫 투명도 (방해금지 중)
                    <span>
                      <input type="range" min={20} max={100} step={5}
                        value={config.petOpacity ?? 40}
                        onChange={(e) => persist({ ...config, petOpacity: Number(e.target.value) })} />
                      {' '}
                      {config.petOpacity ?? 40}%
                    </span>
                  </label>
                  <label className="mh__row">
                    펫 움직임 최소화
                    <input type="checkbox" checked={config.minimalMotion ?? false}
                      onChange={(e) => persist({ ...config, minimalMotion: e.target.checked })} />
                  </label>
                </div>

                <div className="mh__card">
                  <div className="mh__card-head">💊 약 등록 · 관리</div>
                  {config.medications.length > 0 && (
                    <ul className="mh__meds">
                      {config.medications.map((m) => (
                        <li key={m.id}>
                          <span className="mh__med-name">💊 {m.name} <small>{m.times.join(', ')}</small></span>
                          <button className="mh__med-del" onClick={() => persist(removeMed(config, m.id))}>삭제</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mh__guiform" style={{ marginTop: config.medications.length > 0 ? 8 : 4 }}>
                    <input
                      className="mh__ginput"
                      placeholder="약/영양제 이름"
                      value={sName}
                      onChange={(e) => { setSelectedProduct(null); setSName(e.target.value) }}
                      maxLength={200}
                      aria-label="약·건기식 제품 검색"
                    />
                    <p role="status" aria-live="polite">{selectedProduct ? `선택: ${selectedProduct.product_name}` : searchStatus}</p>
                    {!selectedProduct && catalogItems.length > 0 && (
                      <ul aria-label="제품 검색 후보" style={{ listStyle: 'none', padding: 0, maxHeight: 200, overflowY: 'auto' }}>
                        {catalogItems.map((item) => (
                          <li key={`${item.item_type}-${item.product_id}`}>
                            <button type="button" style={{ width: '100%', textAlign: 'left', padding: 8, marginBottom: 4 }}
                              onClick={() => { setSelectedProduct(item); setSName(item.product_name); setCatalogItems([]) }}>
                              {item.product_name}<br /><small>{item.manufacturer_name ?? '제조사 정보 없음'} · {item.item_type === 'DRUG' ? '의약품' : '건강기능식품'}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {!selectedProduct && sName.trim() && searchStatus !== '검색 중…' && (
                      <button type="button" onClick={() => setSearchRevision((n) => n + 1)}>다시 검색</button>
                    )}
                    <div className="mh__gtimes">
                      {sTimes.map((t, i) => (
                        <span key={i} className="mh__gtime">
                          <input
                            type="time"
                            value={t}
                            onChange={(e) => setSTimes((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))}
                          />
                          {sTimes.length > 1 && (
                            <button onClick={() => setSTimes((prev) => prev.filter((_, idx) => idx !== i))}>−</button>
                          )}
                        </span>
                      ))}
                      <button className="mh__gadd" onClick={() => setSTimes((prev) => [...prev, '13:00'])}>
                        + 시간
                      </button>
                    </div>
                    <button
                      className="mh__gsubmit"
                      disabled={!selectedProduct || sTimes.some((t) => !t)}
                      onClick={() => {
                        if (!selectedProduct || sTimes.some((t) => !t)) return
                        registerMed(selectedProduct.product_name, sTimes.map((t) => ({ time: t, label: t })), selectedProduct)
                        setSelectedProduct(null)
                        setSName('')
                        setSTimes(['09:00'])
                      }}
                    >
                      등록
                    </button>
                  </div>
                </div>



                <div className="mh__card">
                  <div className="mh__card-head">🪪 회원번호</div>
                  <div className="mh__member">
                    <code>{config.memberId ?? '발급 중…'}</code>
                    <button
                      onClick={() => {
                        if (config.memberId) void navigator.clipboard?.writeText(config.memberId)
                      }}
                    >
                      복사
                    </button>
                  </div>
                  <p className="mh__guide-note">
                    기록·데이터 관리에 쓰는 나만의 고유번호예요.<br />이름이나 연락처와는 연결되지 않아요.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 우측 책갈피 탭 */}
          <nav className="mh__tabs">
            <button className={`mh__tab mh__tab--heart${mode === 'heart' ? ' on' : ''}`} onClick={() => setMode('heart')}>
              💛<span>마음관리</span>
            </button>
            <button
              className={`mh__tab mh__tab--icon mh__tab--arc${mode === 'archive' ? ' on' : ''}`}
              onClick={() => setMode('archive')}
              title="아카이브"
            >
              📔
            </button>
            <button
              className={`mh__tab mh__tab--icon mh__tab--set${mode === 'settings' ? ' on' : ''}`}
              onClick={() => setMode('settings')}
              title="설정"
            >
              ⚙️
            </button>
          </nav>
        </div>
      </div>
    </div>
  )
}
