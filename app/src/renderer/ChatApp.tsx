// 퐁이네 미니홈 — 싸이월드 미니홈피 문법(미니룸·책갈피 탭·TODAY)을 빌린 케어퐁 허브(기본 창)
// 탭 3종: 💛 마음관리 / 📔 아카이브(도감) / ⚙️ 설정 (약 등록은 설정 안으로 · 기획서 10·11번)
// 약 등록은 LUI(대화)·GUI(폼) 두 경로 제공 + 소요시간 자동 계측 → LUI vs GUI 비교 테스트용
// 공감 응답: 서버 /chat(Bedrock, 10/14 1차 연동) → 실패 시 core/empathy.ts 규칙 응답 폴백. 위기 키워드는 서버에 안 보냄. 약설명은 규칙 기반(core/drugData.ts)
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import type { CatalogItem } from '../core/catalog'
import type { DrugInfo } from '../core/drugData'
import type { Pet } from '../core/types'
import type { UpdateInfo } from '../core/update'
import type { HealthConfig } from '../core/health'
import { DEFAULT_HEALTH_CONFIG, DEFAULT_AUX, createMed, addMed, removeMed, updateMed } from '../core/health'
import { EMPTY_INTAKE, recordMed, recordMedDose, medAllTakenToday, medDoseTakenToday, type IntakeLog } from '../core/intake'
import { startOfLocalDay, currentDueTime } from '../core/scheduler'
import { replyEmpathy } from '../core/empathy'
import { earnsHeart } from '../core/gibberish' // 난타(자판 뭉개기) 판별 — 하트 적립 전처리(gibberish_filter.py 규칙 포팅)
import { parseTimes, tryParseRegister, registerSummary, type ParsedTime } from '../core/medLui'
import { normalizeAncestors, xpProgress, isMaxed } from '../core/progression'
import { spriteUrl, poseUrl, roomBgFor, hasPoses, dexImg, creatureScale } from './sprites'

// 펫 도감 — 베타 2종. 번호(순서)는 '랜덤 첫 등장 캐릭터가 1번' = pet.speciesOrder 기준
const BETA_NAMES: Record<string, string> = { cat: '냥냥퐁', dragon: '용용퐁' }

// 한글 받침 유무로 조사 선택 — 이름+조사. 받침 있으면 withB("둥"+"은"→"둥은"), 없으면 withoutB("퐁이"+"는"→"퐁이는")
// 예: josa(name,'은','는') / josa(name,'이','가') / josa(name,'과','와')
const josa = (name: string, withB: string, withoutB: string): string => {
  const c = name.charCodeAt(name.length - 1)
  const hasBatchim = !Number.isNaN(c) && c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0
  return name + (hasBatchim ? withB : withoutB) // 한글 음절이 아니면(영문·숫자 등) 받침 없음으로 처리
}
const DEFAULT_DEX_ORDER = ['cat', 'dragon'] // speciesOrder 없는 옛 저장용 기본

// 시각 포맷: Date → 오전/오후 H:MM. "다음 알람 시각" 표시용
function fmtClock(d: Date): string {
  let h = d.getHours()
  const ampm = h < 12 ? '오전' : '오후'
  h = h % 12
  if (h === 0) h = 12
  return `${ampm} ${h}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 탭: home(마이룸) · med(약지도) · heart(마음관리) · report(리포트, 준비중) · settings(설정)
// archive는 과거 '도감+일기' 탭 — 1단계에서 도감→home, 일기→heart 로 옮기며 탭에선 제거(타입은 호환 위해 유지)
type ChatMode = 'home' | 'med' | 'heart' | 'report' | 'settings' | 'archive'

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
  candidates?: CatalogItem[] // 약 검색 후보(약지도 대화 안에서 선택 → 등록)
  regProduct?: CatalogItem // 후보 선택 후 시간입력 폼이 등록할 제품
  ts?: number // 작성 시각(ms) — 마음관리 대화 24시간 로컬 보관·만료 판정용. 저장 메시지에만 채움
  mood?: boolean // 기분 체크 문답(오늘 기분:…)은 서버 history·보관에서 제외하기 위한 표시
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
  med: '약 이름만 쳐주세요! 일부만 알아도 돼요 💊 등록할지, 궁금한 건 제가 여쭤볼게요.',
  heart: '집사님, 오늘은 어떤 힘든 일이 있으셨나요? 저랑 같이 이야기해봐요! 💛',
}
// 약지도 퀵리플라이 칩(명세서 2.4) — 누르면 그 문장이 즉시 전송된다(2.3).
const MED_QUICK_CHIPS = ['유산균 아침 등록', '타이레놀 하루 몇 번?', '오늘 약 보여줘']

// ── 업무유형 테스트 설문(업무유형 엑셀 ver.0.5 · 시트4) ───────────────
// 1분 4문항 · 선택지 2개 단일선택. Q1·Q2→축1(L/O), Q3·Q4→축3(A/I).
// 같은 축 2문항 다수결, 1:1이면 앞 문항 우선. 설문은 1·3번째 글자만 즉시 공개(2·4번째는 리듬·HRV 해금).
type WtLetter = 'L' | 'O' | 'A' | 'I'
interface WtQuestion {
  axis: '집중 시간대' | '쉼 스타일'
  q: string
  options: { label: string; letter: WtLetter }[]
}
const WT_QUESTIONS: WtQuestion[] = [
  {
    axis: '집중 시간대',
    q: '하루 중 머리가 제일 잘 돌아가는 때는?',
    options: [
      { label: '🌅 오전 · 아침에 몰아서 하는 편', letter: 'L' },
      { label: '🌙 오후·저녁 · 엔진이 늦게 걸리는 편', letter: 'O' },
    ],
  },
  {
    axis: '집중 시간대',
    q: '중요한 일을 직접 고른다면 언제 하나요?',
    options: [
      { label: '출근 직후, 머리 맑을 때 바로', letter: 'L' },
      { label: '점심 지나고 리듬을 탔을 때', letter: 'O' },
    ],
  },
  {
    axis: '쉼 스타일',
    q: '‘잠깐 쉬어요’ 알림이 오면?',
    options: [
      { label: '🙆 바로 일어나서 쉬는 편', letter: 'A' },
      { label: '🔥 하던 것만 끝내고… 결국 못 쉬는 편', letter: 'I' },
    ],
  },
  {
    axis: '쉼 스타일',
    q: '일이 잘 풀리는 중에 휴식 시간이 되면?',
    options: [
      { label: '그래도 끊고 쉼 · 길게 가려면 쉬어야죠', letter: 'A' },
      { label: '흐름 깨기 싫어서 계속 달림', letter: 'I' },
    ],
  },
]
// 글자별 마우스오버 툴팁(시트2 뜻)
const WT_LETTER_DESC: Record<string, string> = {
  L: 'Lark · 오전 집중형 — 아침에 머리가 제일 잘 돌아가요',
  O: 'Owl · 오후·저녁 집중형 — 엔진이 늦게 걸려요',
  S: 'Sprinter · 짧고 굵게 몰아치는 부하 패턴',
  F: 'Flow · 고르게 꾸준한 부하 패턴',
  A: 'Active rest · 쉬라고 하면 바로 쉬는 스타일',
  I: 'Immersive · 하던 일을 끝내야 쉬는 스타일',
  R: 'Rebounder · 스트레스 후 빨리 튕겨 돌아오는 회복',
  G: 'Gradual charger · 푹 쉬어야 천천히 차오르는 회복',
}
// 다수결(1:1이면 앞 문항 우선) — 축1: [Q1,Q2], 축3: [Q3,Q4]. 2문항이라 같으면 그 값, 다르면 앞 우선.
const wtDecide = (first: WtLetter, second: WtLetter): WtLetter => (first === second ? first : first)
// 과(科) — 축1(L/O) × 축3(A/I) 조합. 2번째(S/F) 해금 전엔 과 안에서 동물 2마리 중 미확정(엑셀 시트1·3·6).
const WT_FAMILY: Record<string, { name: string; a: string; b: string }> = {
  LA: { name: '조류', a: '매', b: '종달새' },        // L-S-A 매 / L-F-A 종달새
  LI: { name: '들판 동물', a: '말', b: '소' },         // L-S-I 말 / L-F-I 소
  OA: { name: '고양잇과', a: '표범', b: '호랑이' },    // O-S-A 표범 / O-F-A 호랑이
  OI: { name: '밤숲 동물', a: '올빼미', b: '고슴도치' }, // O-S-I 올빼미 / O-F-I 고슴도치
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
const ROOM_ALERT_KEY = 'carepong-roomAlertStage' // 이미 해금 얼럿을 띄운 최고 방꾸미기 단계(재접속에도 유지)
const loadRoomAlert = (): number => { try { return Number(localStorage.getItem(ROOM_ALERT_KEY)) || 0 } catch { return 0 } }
const saveRoomAlert = (n: number): void => { try { localStorage.setItem(ROOM_ALERT_KEY, String(n)) } catch { /* noop */ } }
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

// ── 마음관리(공감챗) 대화 이력 로컬 보관 — 이 컴퓨터에만 저장, 서버 전송·암호화 없음(혜윤/TA 요청 ①) ──
// 24시간 지난 메시지는 불러올 때 + 앱 켜 둔 채 10분마다 자동 삭제. 저장은 마음관리(heart) 탭만.
const HEARTCHAT_KEY = 'carepong-heartchat'
const HEARTCHAT_TTL_MS = 24 * 60 * 60 * 1000 // 24시간
const HEARTCHAT_PRUNE_MS = 10 * 60 * 1000 // 보관 메시지 만료 검사 주기(10분)
// 저장용으로 추려 담는 필드만(thinking·card·actions·form 등 일회성 UI는 제외)
interface StoredChat {
  id: number
  role: 'user' | 'pet'
  text: string
  ts: number
  crisis?: boolean
  suggestRelief?: boolean
  mood?: boolean
}
const loadHeartChat = (now: number): ChatMessage[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(HEARTCHAT_KEY) ?? '[]') as StoredChat[]
    if (!Array.isArray(raw)) return []
    // 24시간 지난 건 버린다(ts 없으면 안전하게 버림)
    return raw.filter((m) => typeof m?.ts === 'number' && now - m.ts < HEARTCHAT_TTL_MS)
  } catch {
    return []
  }
}
const saveHeartChat = (msgs: ChatMessage[]): void => {
  try {
    // 완료된(생각중 아님) 메시지만, 저장 필드만 추려 담는다
    const slim: StoredChat[] = msgs
      .filter((m) => !m.thinking && typeof m.ts === 'number')
      .map((m) => ({ id: m.id, role: m.role, text: m.text, ts: m.ts as number, crisis: m.crisis, suggestRelief: m.suggestRelief, mood: m.mood }))
    localStorage.setItem(HEARTCHAT_KEY, JSON.stringify(slim))
  } catch {
    /* 저장 실패해도 대화는 계속 동작 */
  }
}

// ② 서버 /chat 에 함께 보낼 직전 대화(오래된 순, 최대 10개=5턴). 이번 메시지는 호출 전에 피드에 아직 없어야 함.
//   제외: 환영 메시지(id 2) · 위기 문구(서버에 안 보냄) · 기분체크 문답(mood) · 생각중 거품 · 빈 텍스트.
const HISTORY_MAX = 10
const buildHistory = (heartFeed: ChatMessage[]): { role: 'user' | 'pet'; text: string }[] =>
  heartFeed
    .filter((m) => m.id !== 2 && !m.thinking && !m.crisis && !m.mood && !!m.text.trim())
    .slice(-HISTORY_MAX) // 가장 최근 10개(이미 오래된 순으로 쌓여 있음)
    .map((m) => ({ role: m.role, text: m.text }))
// 설정 숫자 입력 범위 보정(최소/최대) — 범위 밖 입력 시 clamp (QA 6#9·10·11)
const clampInt = (v: unknown, lo: number, hi: number): number => {
  const n = Math.round(Number(v))
  return isNaN(n) ? lo : Math.min(hi, Math.max(lo, n))
}
// 시간 24시제 표시 '13:00'→'13시', '13:30'→'13시 30분' (정화님 요청 · 24시제)
const fmtTime = (t: string): string => {
  const [h, m] = (t || '').split(':')
  if (h === undefined) return t
  return `${String(Number(h)).padStart(2, '0')}:${String(Number(m || 0)).padStart(2, '0')}`
}
// 24시간 시:분 선택 — 오전/오후 없이 00~23시 · 분(1분 단위 00~59). 기획서: 00:00~24:00 형식
const TimeSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const [hRaw, mRaw] = (value || '09:00').split(':')
  const h = String(Number(hRaw ?? 9)).padStart(2, '0')
  const m = String(Number(mRaw ?? 0)).padStart(2, '0')
  const mins = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
  return (
    <span className="mh__timesel">
      <select value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)}>
        {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((hh) => (
          <option key={hh} value={hh}>{hh}</option>
        ))}
      </select>
      <span className="mh__timesel-colon">:</span>
      <select value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)}>
        {mins.map((mm) => (
          <option key={mm} value={mm}>{mm}</option>
        ))}
      </select>
    </span>
  )
}
// QA 전용 테스트 버튼 노출 플래그 — 최종 공개 배포 전에는 false로 바꾸고 빌드하세요(일반 사용자에게 숨김).
const QA_MODE = false // 0.3.0 공개 배포: QA 전용 버튼 숨김
// 하트 적립 기준(Q2-a · 기획서8): 공백 제외 2자 이상 AND 자음/모음(미완성 글자)만이 아닌 메시지만 적립 — 오용(ㄱㄴㄷ·ㅏㅑ) 방지
// earnsHeart \ub294 core/gibberish.ts \uc5d0\uc11c import. (gibberish_filter.py \uaddc\uce59 \ud3ec\ud305 \u2014 "\u3148\u31379\u3141\ub824" \ub09c\ud0c0 \ucc28\ub2e8, \u314b\u314b\u314b/\u3160\u3160/\u3131\u3145 \ud1b5\uacfc)
// \ucd5c\uc885 \ud558\ud2b8\ub294 \uc11c\ubc84 source \uac00 'filter'(\uc11c\ubc84\ub3c4 \ub09c\ud0c0 \ud310\uc815) \uac00 \uc544\ub2d0 \ub54c\ub9cc \uc801\ub9bd \u2014 send() \ucc38\uc870.
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

// label 있으면: 아이콘 + 이름 + 긴 바 + 숫자(세로 행 스타일, 기획서). 없으면 기존(아이콘+바)
function MiniBar({ icon, value, color, title, label }: { icon: string; value: number; color: string; title: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <span className={`mh__minibar${label ? ' mh__minibar--row' : ''}`} data-tip={title}>
      <i>{icon}</i>
      {label && <em className="mh__minibar-name">{label}</em>}
      <b>
        <u style={{ width: `${pct}%`, background: color }} />
      </b>
      {label && <span className="mh__minibar-val">{pct}</span>}
    </span>
  )
}

export default function ChatApp() {
  const initialMode = (new URLSearchParams(location.search).get('mode') as ChatMode) || 'home'
  const [mode, setMode] = useState<ChatMode>(initialMode)
  // 마음관리 탭은 지난 24시간 대화를 로컬에서 복원(없으면 환영 메시지만). 환영 메시지는 항상 맨 위 고정.
  const [feeds, setFeeds] = useState<Record<'med' | 'heart', ChatMessage[]>>(() => {
    const restored = loadHeartChat(Date.now())
    return {
      med: [{ id: 1, role: 'pet', text: WELCOME.med }],
      heart: [{ id: 2, role: 'pet', text: WELCOME.heart }, ...restored],
    }
  })
  const [input, setInput] = useState('')
  const [pet, setPet] = useState<Pet | null>(null)
  const [config, setConfig] = useState<HealthConfig>(DEFAULT_HEALTH_CONFIG)
  const [intake, setIntake] = useState<IntakeLog>(EMPTY_INTAKE)
  const [wizard, setWizard] = useState<Wizard>(null)
  const [mood, setMood] = useState<string | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  // 채팅창 넓게 보기 — 확대 버튼은 제거(기획서). 저장된 값이 있으면 레이아웃만 반영.
  const [wideChat] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mh_wideChat') === '1'
    } catch {
      return false
    }
  })
  const [demoOn, setDemoOn] = useState(false)
  const [gName, setGName] = useState('')
  const [gTimes, setGTimes] = useState<string[]>(['09:00'])
  const [regLogs, setRegLogs] = useState<RegLog[]>(loadRegLogs())
  const [localHearts, setLocalHearts] = useState(0) // 저장소 폴링(2초) 사이 즉시 반영용
  const [unlockMsg, setUnlockMsg] = useState<string | null>(null) // 방꾸미기 해금 얼럿(5#21)
  const roomBaselinedRef = useRef(false) // 펫 최초 로드 기준선 설정 여부
  const alertedStageRef = useRef<number>(loadRoomAlert())
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
  const [regNotice, setRegNotice] = useState('') // 중복 등록 안내(비차단) — 알럿 대신 인앱 메시지
  const [showAddForm, setShowAddForm] = useState(false) // 약 1개 이상일 때: '➕ 약 추가' 눌러야 입력 폼이 펼쳐짐(PM 요청)
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null) // 약 삭제 인앱 2단계 확인(비차단)
  const [copied, setCopied] = useState(false) // 회원번호 복사 얼럿
  // 업무유형 테스트 설문 모달 — step: 0~3 문항, 'result' 결과(첫 두 글자). answers 는 각 문항 선택 글자.
  const [wtStep, setWtStep] = useState<number | 'result' | null>(null) // null=닫힘
  const [wtAnswers, setWtAnswers] = useState<WtLetter[]>([])
  const [wtDone, setWtDone] = useState(false) // 설문 1회 완료 → 리포트 카드가 결과(과 공개) 상태로
  const [hrvOpen, setHrvOpen] = useState(false) // HRV 측정 모달(QR) — UI만, 로직 추후
  const [version, setVersion] = useState('') // 현재 설치 버전 (설정 하단 표시)
  const [update, setUpdate] = useState<UpdateInfo | null>(null) // 최신 릴리스 비교 결과
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [sessionStart, setSessionStart] = useState<number | null>(null) // 앱 실행 시작 시각 — 스트레칭·휴식 첫 알람 기준
  // 복원된 대화의 id 와 겹치지 않게 다음 id 를 가장 큰 id+1 로 시작(복원 없으면 3)
  const nextId = useRef(Math.max(2, ...feeds.heart.map((m) => m.id), ...feeds.med.map((m) => m.id)) + 1)
  const feedRef = useRef<HTMLDivElement>(null)
  const alarmCardRef = useRef<HTMLDivElement>(null) // 설정 탭 '알람 간격' 카드 — '알람 당기기'가 여기로 스크롤
  const modeRef = useRef(mode)
  modeRef.current = mode
  const luiStartRef = useRef<number | null>(null)
  const guiStartRef = useRef<number | null>(null)

  // 버전: 앱 시작 시 현재 버전 표시, 설정 탭을 처음 열 때 최신 릴리스와 비교
  const runUpdateCheck = (): void => {
    setCheckingUpdate(true)
    window.petApi
      .checkUpdate()
      .then((u) => { setUpdate(u); setVersion(u.current) })
      .catch(() => { /* 네트워크 실패 등 — 아래 effect의 version만 표시 */ })
      .finally(() => setCheckingUpdate(false))
  }
  useEffect(() => {
    window.petApi.getVersion().then(setVersion).catch(() => { /* 무시 */ })
    window.petApi.sessionStart().then(setSessionStart).catch(() => { /* 무시 */ })
    runUpdateCheck() // 미니홈 진입 시 1회 — 구버전이면 상단 배너로 업데이트 유도(모든 탭)
    // 미니홈을 켜 둔 채로 새 릴리스가 올라와도 배너가 뜨게: 10분마다 + 창 포커스 시 재확인
    const iv = setInterval(runUpdateCheck, 10 * 60 * 1000)
    const onFocus = (): void => runUpdateCheck()
    window.addEventListener('focus', onFocus)
    // 펫 창(30분 주기)이 먼저 새 버전을 발견하면 메인이 밀어줌 → 미니홈을 나갔다 오지 않아도 배너가 뜸
    const offPush = window.petApi.onUpdateInfo((u) => { setUpdate(u); setVersion(u.current) })
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus); offPush() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // ① 마음관리 대화 로컬 보관 — heart 피드가 바뀔 때마다 저장(완료 메시지만, 서버 전송 없음)
  useEffect(() => {
    saveHeartChat(feeds.heart)
  }, [feeds.heart])

  // ① 24시간 만료 — 앱을 켜 둔 채로도 10분마다 오래된 메시지를 걸러낸다(환영 메시지 id 2 는 항상 유지)
  useEffect(() => {
    const prune = (): void => {
      const now = Date.now()
      setFeeds((prev) => {
        const kept = prev.heart.filter((m) => m.id === 2 || m.thinking || typeof m.ts !== 'number' || now - m.ts < HEARTCHAT_TTL_MS)
        if (kept.length === prev.heart.length) return prev // 만료된 게 없으면 그대로(불필요한 리렌더 방지)
        return { ...prev, heart: kept }
      })
    }
    const timer = setInterval(prune, HEARTCHAT_PRUNE_MS)
    return () => clearInterval(timer)
  }, [])

  const push = (m: Omit<ChatMessage, 'id'>): number => {
    const id = nextId.current++
    const t = modeRef.current === 'heart' ? 'heart' : 'med'
    // ts(작성 시각) — 마음관리 대화 24시간 보관·만료 판정용. 생각중(thinking) 거품엔 안 붙임(완료 시 resolveThinking 에서 채움)
    const stamped = m.thinking ? m : { ...m, ts: m.ts ?? Date.now() }
    setFeeds((prev) => ({ ...prev, [t]: [...prev[t], { ...stamped, id }] }))
    return id
  }
  const resolveThinking = (thinkingId: number, reply: Omit<ChatMessage, 'id'>, delayFrom: number): void => {
    const wait = Math.max(0, 900 - (Date.now() - delayFrom))
    const t = modeRef.current === 'heart' ? 'heart' : 'med'
    setTimeout(() => {
      setFeeds((prev) => ({
        ...prev,
        // 답이 확정되는 순간 ts 를 찍어 24시간 보관 대상에 포함(생각중 거품엔 ts 가 없었음)
        [t]: prev[t].map((m) => (m.id === thinkingId ? { ...m, ...reply, thinking: false, ts: m.ts ?? Date.now() } : m)),
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
  const waterToday = intake.waterDayStart === startOfLocalDay(Date.now()) ? intake.waterCups : 0 // 오늘 마신 물(2#16)
  const lifetimeChats = pet?.lifetime.chats ?? 0 // = 누적 하트 (방꾸미기 진척)
  const moodDoneToday = !!diary[dayKeyOf(Date.now())]?.mood // 기분은 하루 1회만(5#38) — diary는 재실행에도 유지
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

  // 방꾸미기 단계 해금 얼럿 (5#21 · QA 2번 29) — 새 단계 도달 시 "최초 1회만".
  // 이미 알린 단계는 localStorage에 저장 → 재접속(창 닫았다 열기) 시 재알림 방지.
  useEffect(() => {
    if (!pet) return // 펫 로드 전(roomStage 과도기) 무시
    if (!roomBaselinedRef.current) {
      // 최초 로드 시점까지 도달한 단계는 '이미 획득'으로 간주 → 로드/재접속 때 얼럿 안 뜸
      roomBaselinedRef.current = true
      if (roomStage > alertedStageRef.current) { alertedStageRef.current = roomStage; saveRoomAlert(roomStage) }
      return
    }
    if (roomStage > alertedStageRef.current) {
      const item = ROOM_STAGES[roomStage - 1]?.item
      if (item) {
        setUnlockMsg(`${item} 생겼어요! 🎉 미니홈을 꾸며보세요`)
        setTimeout(() => setUnlockMsg(null), 3500)
      }
      alertedStageRef.current = roomStage
      saveRoomAlert(roomStage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomStage, pet])

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
    const now = Date.now()
    const med = config.medications.find((m) => m.id === medId)
    const slot = med ? currentDueTime(med, now, startOfLocalDay(now)) : null
    const next = slot ? recordMedDose(intake, medId, slot, now) : recordMed(intake, medId, now)
    setIntake(next)
    window.petApi.saveIntake(next)
    push({ role: 'pet', text: `${name} 복용 체크! ✅ 잘 챙기셨어요. 오늘도 제가 곁에서 응원할게요.` })
  }

  // 같은 약 판정 — 제품 ID가 있으면 ID, 없으면 이름(trim)으로 비교
  const isSameMed = (m: { name: string; product_id?: number }, name: string, product?: CatalogItem): boolean => {
    if (product?.product_id != null && m.product_id != null) return m.product_id === product.product_id
    return m.name.trim() === name.trim()
  }

  // ── 약 등록 (LUI·GUI 공용) · 중복/병합 처리 ──
  // 같은 약+시간 모두 같으면 '이미 등록' 알럿, 같은 약 다른 시간이면 기존 항목에 시간만 추가.
  const registerMed = (name: string, times: ParsedTime[], product?: CatalogItem): boolean => {
    const newTimes = times.map((t) => t.time)
    const existing = config.medications.find((m) => isSameMed(m, name, product))
    if (existing) {
      const have = new Set(existing.times)
      const toAdd = newTimes.filter((t) => !have.has(t))
      if (toAdd.length === 0) {
        // 비차단 처리 — 블로킹 window.alert는 이후 시간 입력(select)을 먹통으로 만듦. 안내는 호출부에서.
        return false
      }
      const mergedTimes = [...existing.times, ...toAdd].sort()
      const nextCfg = updateMed(config, existing.id, { times: mergedTimes })
      window.petApi.saveConfig(nextCfg)
      setConfig(nextCfg)
      return true
    }
    const med = createMed(
      crypto.randomUUID(),
      name,
      product?.item_type === 'HFF',
      newTimes,
      [],
      { timing: times[0]?.timing },
    )
    if (product) Object.assign(med, {
      item_type: product.item_type, product_id: product.product_id,
      external_id: product.external_id, manufacturer_name: product.manufacturer_name,
    })
    window.petApi.saveConfig(addMed(config, med))
    setConfig((c) => addMed(c, med))
    return true
  }
  const logReg = (method: 'lui' | 'gui', startedAt: number | null): void => {
    if (startedAt == null) return
    setRegLogs(appendRegLog({ method, ms: Date.now() - startedAt, at: Date.now() }))
  }

  const handleMedMessage = (text: string, thinkingId: number, started: number): void => {
    // '오늘 약 보여줘' — 등록된 약 목록
    if (/오늘/.test(text) && /약|복약/.test(text)) {
      const lines = config.medications.map(
        (m) => `· ${m.name} ${m.times.map(fmtTime).join(', ')} ${takenToday(m.id) ? '✅ 완료' : '⬜ 아직'}`,
      )
      resolveThinking(
        thinkingId,
        {
          role: 'pet',
          text:
            lines.length > 0 ? `오늘의 복약이에요!\n${lines.join('\n')}` : '아직 등록된 약이 없어요. 약 이름을 쳐서 등록해보세요!',
        },
        started,
      )
      return
    }
    // '유산균 아침 등록'처럼 등록 의도면 약 이름만 뽑아 검색(시간 지정은 후보 선택 후 폼에서)
    const parsed = tryParseRegister(text)
    const query = parsed?.name?.trim() || text
    // 약 이름으로 검색 → 후보를 대화 안에서 보여주고, 선택하면 약지도 안에서 바로 등록
    window.careApi
      .searchDrug(query)
      .then((res) => {
        if (res.error) {
          resolveThinking(thinkingId, { role: 'pet', text: res.error }, started)
        } else if (res.items.length > 0) {
          resolveThinking(
            thinkingId,
            {
              role: 'pet',
              text: `‘${query}’ 검색 결과예요. 등록할 약을 골라주세요 💊`,
              candidates: res.items,
            },
            started,
          )
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
  // 약지도 대화에서 후보 선택 → 시간입력 폼 메시지 push
  const pickCandidate = (msgId: number, product: CatalogItem): void => {
    // 후보 버튼 제거(재클릭 방지)
    setFeeds((prev) => ({ ...prev, med: prev.med.map((m) => (m.id === msgId ? { ...m, candidates: undefined } : m)) }))
    setGTimes(['09:00'])
    push({ role: 'pet', text: `‘${product.product_name}’, 언제 챙길까요? 시간을 정해 등록해요 ⏰`, regProduct: product })
  }
  // 후보 선택 후 시간입력 폼에서 등록
  const submitReg = (formMsgId: number, product: CatalogItem): void => {
    const ok = registerMed(product.product_name, gTimes.map((t) => ({ time: t, label: t })), product)
    setFeeds((prev) => ({ ...prev, med: prev.med.map((m) => (m.id === formMsgId ? { ...m, regProduct: undefined } : m)) }))
    if (!ok) {
      push({ role: 'pet', text: '이미 등록된 약·시간이에요 🙂 시간을 바꿔서 다시 등록해 주세요.' })
      return
    }
    setGTimes(['09:00'])
    push({ role: 'pet', text: `${product.product_name}, ${gTimes.join(', ')} · 매일로 등록했어요! 💊 설정 탭 ‘약 등록 관리’에서도 확인할 수 있어요.` })
  }

  const send = (e: FormEvent): void => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    sendText(text)
  }
  // 입력창·퀵리플라이 칩 공용 전송 — 칩은 해당 문장을 즉시 전송(명세서 2.3). 기존 send 로직 그대로.
  const sendText = (text: string): void => {
    if (!text) return
    // ② 서버에 보낼 직전 대화 이력(history) — 이번 user 말을 피드에 넣기 "전"의 heart 피드로 만든다(이번 message 제외).
    //   오래된 순, 최대 10개(5턴). 환영 메시지·위기 문구·기분체크 문답은 뺀다. 마음관리(heart) 탭에서만.
    const history = mode === 'heart' ? buildHistory(feeds.heart) : []
    push({ role: 'user', text })
    const thinkingId = push({ role: 'pet', text: '', thinking: true })
    const started = Date.now()
    if (mode === 'med') {
      // 하트 적립은 '마음관리' 채팅에서만 — 약지도 대화는 하트 적립 대상 아님(기획 반영)
      handleMedMessage(text, thinkingId, started)
    } else {
      recordDiary({ note: text }) // 마음 일기장에 남김
      const local = replyEmpathy(text) // 규칙 응답 — 위기 판정·완화 제안 플래그·서버 실패 시 폴백
      const logChat = (source: 'rule' | 'bedrock' | 'filter'): void =>
        // 공감챗봇 메시지 (호출위치표 D) — 원문 저장 X, 길이·키워드 적중 여부·응답 출처만. source='filter' = 서버 난타 판정
        window.careApi.logEvent?.('chat_message', 'M05', { len: text.length, keyword_hit: !!(local.crisis || local.suggestRelief), source })
      // ③ 하트는 "서버 응답 후"에만 — 앱 1차 난타 필터 통과 && 서버가 filter 로 되돌리지 않은 경우에만 +1.
      const grantHeart = (serverSource: string): void => {
        if (earnsHeart(text) && serverSource !== 'filter') sendChatPing()
      }
      if (local.crisis) {
        // 안전 > 페르소나: 위기 신호는 LLM 에 보내지 않고(서버 전송 X) 전문기관 안내 고정 문구. 하트는 적립하지 않음.
        logChat('rule')
        resolveThinking(thinkingId, { role: 'pet', text: local.text, crisis: true }, started)
        return
      }
      // 1차(10/14) LLM 연동: 서버 /chat → Bedrock 프롬프트(혜윤). 503/502/429·오프라인이면 규칙 응답으로 폴백.
      // ⚠ 이 블록을 지우면 챗이 규칙 응답으로만 돌아감 (10/14 0.2.5 에서 한 번 덮어써져 사라졌음)
      window.careApi
        .chat(text, history)
        .then((r) => {
          // 서버가 난타로 판정하면(source='filter') reply 는 그대로 말풍선에 띄우되 하트는 적립하지 않음
          logChat(r.source === 'filter' ? 'filter' : 'bedrock')
          grantHeart(r.source)
          resolveThinking(thinkingId, { role: 'pet', text: r.reply, suggestRelief: local.suggestRelief }, started)
        })
        .catch(() => {
          // 서버 실패 → 규칙 응답 폴백. 서버 판정을 못 받았으므로 앱 1차 필터만으로 하트 결정.
          logChat('rule')
          grantHeart('rule')
          resolveThinking(thinkingId, { role: 'pet', text: local.text, suggestRelief: local.suggestRelief }, started)
        })
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
      // 약 등록은 약지도 안에서 — 약 이름을 치면 검색 후보가 떠요
      push({ role: 'pet', text: '등록할 약 이름을 쳐주세요! 검색해서 후보를 보여드릴게요 💊 (예: 타이레놀)' })
    } else if (action === 'ask') {
      push({ role: 'pet', text: '궁금한 약 이름을 쳐주세요. 검색해서 알려드릴게요 🔍' })
    } else {
      push({ role: 'pet', text: '무엇을 도와드릴까요?', actions: MED_ENTRY_ACTIONS })
    }
  }

  // ── 업무유형 테스트 설문 ──
  const wtStart = (): void => { setWtAnswers([]); setWtStep(0) } // 시작·재설문(답만 초기화, 완료 플래그는 유지)
  const wtClose = (): void => setWtStep(null)
  const wtPick = (letter: WtLetter): void => {
    const next = [...wtAnswers, letter]
    setWtAnswers(next)
    if (typeof wtStep === 'number' && wtStep < WT_QUESTIONS.length - 1) setWtStep(wtStep + 1)
    else setWtStep('result')
  }
  const wtSeeCard = (): void => { setWtDone(true); setWtStep(null) } // '결과 카드 보기' — 리포트 카드가 과 공개 상태로
  // 퐁이 제안 '알람 당기기' — 설정 탭으로 가서 알람 간격 카드로 스크롤(시간 조정 위치)
  const goAlarmSettings = (): void => {
    setMode('settings')
    setTimeout(() => {
      alarmCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      alarmCardRef.current?.classList.add('mh__card--flash')
      setTimeout(() => alarmCardRef.current?.classList.remove('mh__card--flash'), 1400)
    }, 80)
  }
  // 결과 첫 두 글자 — 축1(Q1,Q2 다수결)·축3(Q3,Q4 다수결). 2·4번째는 리듬·HRV 해금 전이라 '?'
  const wtAxis1: WtLetter | null = wtAnswers.length >= 2 ? wtDecide(wtAnswers[0], wtAnswers[1]) : null
  const wtAxis3: WtLetter | null = wtAnswers.length >= 4 ? wtDecide(wtAnswers[2], wtAnswers[3]) : null
  const wtFamily = wtAxis1 && wtAxis3 ? WT_FAMILY[`${wtAxis1}${wtAxis3}`] : null // 과(科) 정보

  const submitGui = (formMsgId: number): void => {
    if (!gName.trim()) return
    const ok = registerMed(
      gName.trim(),
      gTimes.map((t) => ({ time: t, label: t })),
    )
    if (!ok) {
      // 같은 약·같은 시간 — 안내만(비차단), 폼은 그대로 두어 시간 바꿔 재등록 가능
      push({ role: 'pet', text: '이미 등록된 약·시간이에요 🙂 시간을 바꿔서 다시 등록해 주세요.' })
      return
    }
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
    if (moodDoneToday) return // 하루 1회만(5#38)
    setMood(m.emoji)
    recordDiary({ mood: m.emoji, moodLabel: m.label })
    window.careApi.logEvent?.('mood_checked', 'M05', { mood: m.emoji })
    sendChatPing()
    // 기분체크 문답은 mood:true 로 표시 — 서버 history 에 넣지 않는다(TA 요청 ②). 보관은 되어 화면 복원은 됨.
    push({ role: 'user', text: `오늘 기분: ${m.emoji} ${m.label}`, mood: true })
    const id = push({ role: 'pet', text: '', thinking: true, mood: true })
    resolveThinking(id, { role: 'pet', text: m.reply, suggestRelief: m.relief, mood: true }, Date.now() - 400)
  }

  // ── 설정 저장 헬퍼 ──
  const persist = (next: HealthConfig): void => {
    setConfig(next)
    window.petApi.saveConfig(next)
  }
  const aux = config.aux ?? DEFAULT_AUX
  // "다음 ○○ 시각" — 실제 알람 기준(마지막 이행 or 앱 시작 + 간격)으로 고정 표시. 미니홈 열 때마다 바뀌지 않음.
  const nextIntervalLabel = (last: number | null, intervalMin: number): string => {
    const base = last ?? sessionStart ?? Date.now()
    const next = base + Math.max(0, intervalMin) * 60000
    return next <= Date.now() ? '곧' : fmtClock(new Date(next))
  }
  const nextWaterLabel = (): string => {
    if (waterToday >= config.water.dailyTargetCups) return '오늘 목표 달성 🎉'
    if (intake.lastDrinkAt == null) return '곧'
    const next = intake.lastDrinkAt + config.water.intervalMinutes * 60000
    return next <= Date.now() ? '곧' : fmtClock(new Date(next))
  }
  const avg = (method: 'lui' | 'gui'): number | null => {
    const arr = regLogs.filter((r) => r.method === method)
    if (arr.length === 0) return null
    return Math.round(arr.reduce((s, r) => s + r.ms, 0) / arr.length / 100) / 10
  }

  const petName = pet?.name ?? '퐁이'
  const petImg = pet ? (poseUrl(pet.creature, pet.stage, 'idle') ?? spriteUrl(pet.creature, pet.stage)) : undefined
  const roomBg = roomBgFor(pet?.creature ?? 'cat', lifetimeChats)
  const chatMode = mode === 'heart' ? 'heart' : 'med'
  const messages = feeds[chatMode]

  return (
    <div className={`mh mh--${mode}${wideChat ? ' mh--wide' : ''}`}>
      <header className="mh__bar">
        <span className="mh__title">
          {petName}
          <small>의 미니홈</small>
        </span>
        <button className="mh__help" onClick={() => setGuideOpen((v) => !v)} title="이 게임 설명 보기">
          ?
        </button>
      </header>

      {/* ── 펫 정보바: 이름·레벨·세대 + TODAY 배지 (작은 얼굴 아이콘 제거) ── */}
      <div className="mh__petbar">
        <span className="mh__petbar-name">{petName}</span>
        <span className="mh__petbar-meta">Lv.{pet?.stage ?? 1} · {pet?.generation ?? 1}번째 친구</span>
        <span className="mh__petbar-today">TODAY 😊</span>
      </div>

      {update && !update.isLatest && (
        <div className="mh__updatebar">
          <span>🔔 새 버전 <b>v{update.latest}</b>이 나왔어요. 정확한 기록을 위해 업데이트가 필요해요.</span>
          {update.downloadUrl && (
            <button onClick={() => window.petApi.openExternal(update.downloadUrl as string)}>⬇ 업데이트</button>
          )}
        </div>
      )}

      {/* ── 상단 가로 탭 (마이룸·약지도·마음관리·리포트·설정) ── */}
      <nav className="mh__toptabs">
        <button className={`mh__toptab${mode === 'home' ? ' on' : ''}`} onClick={() => setMode('home')}>
          <span className="mh__toptab-ico" aria-hidden>🏠</span><span className="mh__toptab-txt">마이룸</span>
        </button>
        <button className={`mh__toptab${mode === 'med' ? ' on' : ''}`} onClick={() => setMode('med')}>
          <span className="mh__toptab-ico" aria-hidden>💊</span><span className="mh__toptab-txt">약지도</span>
        </button>
        <button className={`mh__toptab${mode === 'heart' ? ' on' : ''}`} onClick={() => setMode('heart')}>
          <span className="mh__toptab-ico" aria-hidden>💛</span><span className="mh__toptab-txt">마음관리</span>
        </button>
        <button className={`mh__toptab${mode === 'report' ? ' on' : ''}`} onClick={() => setMode('report')}>
          <span className="mh__toptab-ico" aria-hidden>📊</span><span className="mh__toptab-txt">리포트</span>
        </button>
        <button className={`mh__toptab${mode === 'settings' ? ' on' : ''}`} onClick={() => setMode('settings')}>
          <span className="mh__toptab-ico" aria-hidden>⚙️</span><span className="mh__toptab-txt">설정</span>
        </button>
      </nav>

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
                <tr><th>🩷 행복</th><td>쓰다듬기 <b>+12</b> · 명상 <b>+12</b> · 심호흡 <b>+10</b> · 산책 <b>+8</b> · 밥 <b>+5</b> · 스트레칭 <b>+3</b></td></tr>
                <tr><th>💪 건강</th><td>산책 <b>+10</b> · 밥 <b>+8</b> · 물 <b>+5</b> · 스트레칭 <b>+5</b> · 쓰다듬기 <b>+3</b></td></tr>
                <tr><th>⚡ 기력</th><td>밥 <b>+12</b> · 명상 <b>+10</b> · 약 챙기기 <b>+10</b> · 휴식 <b>+8</b> · 심호흡 <b>+8</b> <small>(산책은 −12 소모)</small></td></tr>
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
        {/* ── 마이룸(home) 탭에서만: 미니룸 + 펫상태 + 오늘의 하트 (하나의 큰 흰 박스로 묶음) ── */}
        {mode === 'home' && (<div className="mh__homebox">
        {/* 미니룸 — 가구: 창문·액자·시계·책장·침대·화분·스탠드 */}
        <div className="mh__room">
          {/* 방꾸미기 — 누적 하트 단계별 전체 방 배경 이미지 (0=빈방) */}
          {roomBg && <img className="mh__room-bg" src={roomBg} alt="" draggable={false} />}
          {/* 이전 펫은 방에 표시하지 않음 — 펫 도감에서 수집(기획서 7번) */}
          <div className="mh__petspot">
            {petImg ? (
              <img className={`mh__pet${creatureScale(pet?.creature ?? 'cat') !== 1 ? ' mh__pet--sq' : ''}`} src={petImg} alt={petName} draggable={false} />
            ) : (
              <span className="mh__pet-fallback">🐱</span>
            )}
          </div>
          <div className="mh__plate">
            {petName} <small>Lv.{pet?.stage ?? 1} · {pet?.generation ?? 1}번째 아이</small>
          </div>
        </div>

        {/* 펫 상태 — 행복·건강·기력·XP (기획서: 제목 카드 + 세로 4줄, 이름·숫자 포함) */}
        {pet && (
          <div className="mh__statcard">
            <div className="mh__statcard-head">펫 상태</div>
            <div className="mh__stats mh__stats--col">
              <MiniBar icon="🩷" label="행복" value={pet.stats.happiness} color="#ff6b8a" title={`행복 ${Math.round(pet.stats.happiness)}\n쓰다듬기 +12 · 명상 +12 · 심호흡 +10 · 산책 +8 · 밥 +5 · 스트레칭 +3`} />
              <MiniBar icon="💪" label="건강" value={pet.stats.health} color="#5ec27a" title={`건강 ${Math.round(pet.stats.health)}\n산책 +10 · 밥 +8 · 물 +5 · 스트레칭 +5 · 쓰다듬기 +3`} />
              <MiniBar icon="⚡" label="기력" value={pet.stats.energy} color="#f2b441" title={`기력 ${Math.round(pet.stats.energy)}\n밥 +12 · 명상 +10 · 약 +10 · 휴식 +8 · 심호흡 +8 (산책은 −12 소모)`} />
              <MiniBar
                icon="⭐" label="XP"
                value={xpProgress(pet).pct}
                color="#b9aee8"
                title={isMaxed(pet) ? '환생 준비 완료! 이제 다음 친구를 만날 수 있어요' : `XP ${xpProgress(pet).into}/${xpProgress(pet).needed}\n${pet.stage >= 5 ? '환생까지 쑥쑥!' : '돌보고 수다 떨면 쑥쑥!'}`}
              />
            </div>
          </div>
        )}

        {/* 오늘의 하트 · 방 꾸미기 — 카드(기획서): 제목 + 하트 10칸 + 누적 + 진척바 */}
        {pet && (
          <div className="mh__heartcard">
            <div
              className="mh__hearts"
              data-tip={heartsToday >= 10 ? '오늘 하트 만땅! 보너스 받았어요' : `오늘 나눈 대화 ${heartsToday}/10\n다 채우면 보너스 XP!`}
            >
              <span className="mh__hearts-label">오늘의 하트</span>
              <span className="mh__hearts-note">하트는 방 꾸미기 전용</span>
              <span className="mh__hearts-row">
                {Array.from({ length: 10 }, (_, i) => (
                  <i key={i} className={i < heartsToday ? 'on' : ''}>
                    {i < heartsToday ? '🧡' : '🤍'}
                  </i>
                ))}
              </span>
              {/* 누적 하트 — 이 캐릭터 방꾸미기 진척(환생 시 0부터) */}
              <span className="mh__hearts-acc">🧡 누적 {lifetimeChats}</span>
            </div>
            {/* 다음 꾸미기까지 진척바 (현재/목표) */}
            {nextRoom ? (
              <div className="mh__roomprog">
                <div className="mh__roomprog-top">
                  다음 {nextRoom.item}까지 🧡 <b>{Math.max(0, nextRoom.hearts - lifetimeChats)}</b>개 남았어요
                  <span className="mh__roomprog-frac">({lifetimeChats}/{nextRoom.hearts})</span>
                </div>
                <div className="mh__roomprog-track">
                  <span style={{ width: `${Math.min(100, Math.round((lifetimeChats / nextRoom.hearts) * 100))}%` }} />
                </div>
              </div>
            ) : (
              <div className="mh__roomprog">
                <div className="mh__roomprog-top">방 꾸미기 풀세트 완성! 🎉</div>
                <div className="mh__roomprog-track"><span style={{ width: '100%' }} /></div>
              </div>
            )}
          </div>
        )}
        </div>)}

        <div className="mh__body">
          <div className="mh__content">
            {unlockMsg && <div className="mh__unlock" role="status">{unlockMsg}</div>}
            {/* ── 🏠 마이룸(home) — 펫 도감 (미니룸·상태·하트는 위 고정 영역에 표시) ── */}
            {mode === 'home' && (
              <div className="mh__settings">
                <div className="mh__card">
                  <div className="mh__card-head">📖 펫 도감</div>
                  <div className="mh__dexrow">
                    {(pet?.speciesOrder && pet.speciesOrder.length > 0 ? pet.speciesOrder : DEFAULT_DEX_ORDER).map((creature, i) => {
                      const order = i + 1 // 랜덤 첫 등장 캐릭터가 1번
                      const anc = normalizeAncestors(pet?.ancestors)
                      const isActive = pet?.creature === creature
                      const ancMatch = anc.find((a) => a.creature === creature)
                      const acquired = hasPoses(creature) && (isActive || !!ancMatch)
                      const url = acquired
                        ? poseUrl(creature, isActive ? pet?.stage ?? 1 : 5, 'idle')
                        : undefined
                      const nm = isActive ? petName : ancMatch?.name ?? BETA_NAMES[creature] ?? creature
                      return (
                        <div key={creature} className={`mh__dexslot${acquired ? ' mh__dexslot--got' : ''}`}>
                          <div className="mh__dexart">
                            {acquired && url ? (
                              <img className={`mh__deximg${creatureScale(creature) !== 1 ? ' mh__deximg--sq' : ''}`} src={url} alt={nm} draggable={false} />
                            ) : (
                              <img className="mh__deximg mh__deximg--myst" src={dexImg('mystery')} alt="미공개" draggable={false} />
                            )}
                            <img className="mh__dexframe" src={dexImg('frame')} alt="" draggable={false} />
                            <span className="mh__dexno">{order}</span>
                          </div>
                          <small className="mh__dexname">{acquired ? nm : '???'}</small>
                        </div>
                      )
                    })}
                    {/* 미공개 자리 — 추후 추가될 3번째 캐릭터(지금은 항상 미스터리 박스) */}
                    <div key="future" className="mh__dexslot">
                      <div className="mh__dexart">
                        <img className="mh__deximg mh__deximg--myst" src={dexImg('mystery')} alt="미공개" draggable={false} />
                        <img className="mh__dexframe" src={dexImg('frame')} alt="" draggable={false} />
                        <span className="mh__dexno">{(pet?.speciesOrder?.length ?? DEFAULT_DEX_ORDER.length) + 1}</span>
                      </div>
                      <small className="mh__dexname">???</small>
                    </div>
                  </div>
                  <p className="mh__empty">레벨 5가 되면 랜덤으로 환생해요.<br />미스테리 펫을 모아보세요.</p>
                </div>
              </div>
            )}
            {mode === 'med' && (
              /* 약지도 상단 요약 바(기획서·명세서 2.1) — 오늘 복약 n/n, 클릭 시 리포트 탭 이동 */
              <button
                type="button"
                className="mh__medbar"
                onClick={() => setMode('report')}
                aria-label="오늘 복약 요약 — 리포트 보러가기"
              >
                <span className="mh__medbar-main">
                  💊 오늘 복약 <b>{config.medications.filter((m) => takenToday(m.id)).length}/{config.medications.length}</b> 완료
                  <span className="mh__medbar-sub">도장판·순응률은 리포트에서</span>
                </span>
                <span className="mh__medbar-go">보러가기 →</span>
              </button>
            )}

            {mode === 'heart' && (
              <>
                {/* 기획서 순서: ① 오늘 기분 어때요? → ② 1분 쉬어가기 → 채팅. 일기장 달력은 리포트 탭으로 이동 */}
                {!mood && !moodDoneToday && (
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
                <div ref={feedRef} className={`mh__feed${mode === 'heart' ? ' mh__feed--heart' : ''}${mode === 'med' ? ' mh__feed--med' : ''}`}>
                  {messages.map((m) =>
                    m.role === 'user' ? (
                      <div key={m.id} className="msg msg--user">
                        <p>{m.text}</p>
                      </div>
                    ) : (
                      <Fragment key={m.id}>
                      <div className="msg msg--pet">
                        {petImg ? (
                          <img className="msg__avatar-img" src={petImg} alt="" aria-hidden draggable={false} />
                        ) : (
                          <span className="msg__avatar" aria-hidden>🐱</span>
                        )}
                        <div className={`msg__bubble${m.crisis ? ' msg__bubble--crisis' : ''}`}>
                          {m.thinking ? (
                            <span className="thinking" aria-label={`${josa(petName, '이', '가')} 생각하는 중`}>
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
                          {/* 약 검색 후보 — 약지도 대화 안에서 선택 → 등록 */}
                          {m.candidates && !m.thinking && (
                            <ul className="mh__cand mh__cand--inmsg" aria-label="약 검색 후보">
                              {m.candidates.map((item) => (
                                <li key={`${item.item_type}-${item.product_id}`}>
                                  <button type="button" onClick={() => pickCandidate(m.id, item)}>
                                    {item.product_name}
                                    <br />
                                    <small>{item.manufacturer_name ?? '제조사 정보 없음'} · {item.item_type === 'DRUG' ? '의약품' : '건강기능식품'}</small>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {/* 후보 선택 후 시간 입력 → 등록(약지도 안에서 완결) */}
                          {m.regProduct && !m.thinking && (
                            <div className="mh__guiform mh__guiform--inmsg">
                              <div className="mh__gtimes">
                                {gTimes.map((t, i) => (
                                  <span key={i} className="mh__gtime">
                                    <TimeSelect
                                      value={t}
                                      onChange={(v) => setGTimes((prev) => prev.map((x, idx) => (idx === i ? v : x)))}
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
                              <button
                                className="mh__gsubmit"
                                disabled={gTimes.some((t) => !t)}
                                onClick={() => submitReg(m.id, m.regProduct as CatalogItem)}
                              >
                                💊 {m.regProduct.product_name} 등록
                              </button>
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
                                    <TimeSelect
                                      value={t}
                                      onChange={(v) =>
                                        setGTimes((prev) => prev.map((x, idx) => (idx === i ? v : x)))
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
                              <button
                                className="mh__gsubmit"
                                disabled={!gName.trim() || gTimes.some((t) => !t)}
                                onClick={() => submitGui(m.id)}
                              >
                                등록
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* 퀵리플라이 칩(명세서 2.4) — 안내 말풍선 "아래" 독립 줄 · 누르면 즉시 전송(2.3) */}
                      {mode === 'med' && m.id === 1 && (
                        <div className="mh__quickchips">
                          {MED_QUICK_CHIPS.map((c) => (
                            <button key={c} type="button" className="mh__quickchip" onClick={() => sendText(c)}>
                              {c}
                            </button>
                          ))}
                        </div>
                      )}
                      </Fragment>
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
                            : '약 이름 일부만 쳐도 돼요 · "타이레놀"'
                          : `${petName}에게 오늘 이야기를 들려주세요`
                      }
                      aria-label={`${petName}에게 말하기`}
                    />
                    <button type="submit">보내기</button>
                  </div>
                  <p className="mh__disclaimer">
                    {mode === 'med'
                      ? '의약품 정보는 참고용이에요. 약은 처방·약사 지시가 우선이에요.'
                      : `${josa(petName, '은', '는')} 상담사·의사가 아니라 곁을 지키는 친구예요. 많이 힘들 땐 자살예방상담 109.`}
                  </p>
                </form>
              </>
            ) : mode === 'report' ? (
              /* ── 📊 리포트 — 흩어진 기록 모아보기 · 오늘 > 이번 달 > 나 (기획서 CP-REP, UI 껍데기·더미값) ── */
              <div className="mh__settings mh__report">
                {/* ═══ 오늘 ═══ */}
                <div className="mh__rep-sec">오늘</div>

                {/* 2.1 히어로 — 오늘 업무 스트레스 백분위 + 3단 밴드 + 퐁이 제안 */}
                <div className="mh__card mh__rep-hero">
                  <div className="mh__hero-label">오늘 업무 스트레스</div>
                  <div className="mh__hero-pct"><small>상위</small> <b>34</b><span>%</span></div>
                  <div className="mh__hero-base">내 최근 4주 대비</div>
                  <div className="mh__hero-note">의학적 지표가 아니에요</div>
                  <div className="mh__hero-say">
                    {petImg && <img className="mh__hero-face" src={petImg} alt="" aria-hidden draggable={false} />}
                    <p>“집사님, 오늘은 최근 4주 중 상위 34%로 조금 바빴어요. 그래도 잘 버티셨어요!”</p>
                  </div>
                </div>

                {/* 2.2 업무리듬 — 목표 4종 1줄 + 하루 리듬 그래프(3단 밴드) */}
                <div className="mh__card mh__rep-rhythm">
                  <div className="mh__card-head">업무리듬<span className="mh__card-sub">08:30 – 18:30</span></div>
                  <div className="mh__rhythm-goals">
                    <span>오늘 목표</span>
                    <b>💊 <em>2/3</em></b>
                    <b>💧 <em>6/8</em></b>
                    <b>🌙 <em>5회</em></b>
                    <b>🫧 <em>4회</em></b>
                  </div>
                  <div className="mh__rhythm-chart">
                    <div className="mh__rh-ylabels"><span>힘듦</span><span>보통</span><span>여유</span></div>
                    <svg className="mh__rh-svg" viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden>
                      <rect x="0" y="0" width="300" height="40" fill="#ffe7e0" />
                      <rect x="0" y="40" width="300" height="40" fill="#fff3d8" />
                      <rect x="0" y="80" width="300" height="40" fill="#e3f4ea" />
                      <polyline
                        points="10,95 55,60 95,30 130,70 170,88 210,35 250,55 290,92"
                        fill="none" stroke="#5a8fd6" strokeWidth="3"
                        strokeLinecap="round" strokeLinejoin="round"
                      />
                      {[['10','95'],['55','60'],['95','30'],['130','70'],['170','88'],['210','35'],['250','55'],['290','92']].map(([x,y],i)=>(
                        <circle key={i} cx={x} cy={y} r="3.5" fill="#5a8fd6" />
                      ))}
                    </svg>
                  </div>
                  <div className="mh__rh-xaxis"><span>08:30</span><span>12:00</span><span>15:00</span><span>18:30</span></div>
                  <p className="mh__rep-foot">🌿 완화한 시점 · 점수 숫자는 보여주지 않아요 (3단계만)</p>
                </div>

                {/* ═══ 이번 달 ═══ */}
                <div className="mh__rep-sec">이번 달<span className="mh__rep-sec-r">10월</span></div>

                {/* 2.3 헬스케어 달력 — 기분 이모지 + 복약 점 + 연속 배지 + 주간 완화 요약 */}
                <div className="mh__card mh__rep-cal">
                  <div className="mh__card-head">헬스케어 달력<span className="mh__card-sub">10월</span></div>
                  <div className="mh__cal-badge">💊 연속 5일째 복약 성공 중! · 이번 달 90%</div>
                  <div className="mh__cal">
                    {['일','월','화','수','목','금','토'].map((w)=>(<span key={w} className="mh__cal-wd">{w}</span>))}
                    {Array.from({ length: new Date(2026, 9, 1).getDay() }, (_, i) => (
                      <span key={`b${i}`} className="mh__cal-cell mh__cal-cell--empty" />
                    ))}
                    {Array.from({ length: 31 }, (_, i) => {
                      const day = i + 1
                      // 더미: 기분 이모지·복약 점을 샘플로 흩뿌림(데이터는 추후 연결)
                      const face = ['😄','😊','😐','😟','😣']
                      const hasMood = day % 2 === 1 && day <= 26
                      const med = day % 3 !== 0 && day <= 26
                      const isToday = day === 26
                      return (
                        <span key={day} className={`mh__cal-cell${isToday ? ' mh__cal-cell--today' : ''}${hasMood ? ' mh__cal-cell--has' : ''}`}>
                          <em>{day}</em>
                          {hasMood && <span className="mh__cal-mood">{face[day % 5]}</span>}
                          {med && <i className="mh__cal-dot" aria-hidden />}
                          {isToday && <span className="mh__cal-todaytag">오늘</span>}
                        </span>
                      )
                    })}
                  </div>
                  <p className="mh__rep-foot">이모지 = 그날 기분 · <i className="mh__cal-dot mh__cal-dot--inline" /> = 복약 다 챙긴 날</p>
                  <p className="mh__rep-foot">이번 주 완화: 🫧 3회 · 🌙 2회 · 💧 수분 4/6 · 심호흡 후 회복 반응 <b className="mh__up">+12%</b></p>
                </div>

                {/* ═══ 나 ═══ */}
                <div className="mh__rep-sec">나</div>

                {/* 2.4 업무유형 테스트 — 설문 전: 잠금 / 설문 후: 과(科) 공개 + HRV 측정 */}
                <div className="mh__card mh__rep-type">
                  <div className="mh__type-pill">🧭 업무유형 테스트</div>

                  {wtDone && wtFamily ? (
                    /* ── 설문 완료 후: 과 공개 상태 ── */
                    <>
                      <div className="mh__type-title">{wtFamily.name} · {wtFamily.a}일까, {wtFamily.b}일까?</div>
                      <div className="mh__type-stage">
                        {petImg && <img className="mh__type-face" src={petImg} alt="" aria-hidden draggable={false} />}
                        <button type="button" className="mh__hrv-btn" onClick={() => setHrvOpen(true)}>💓<br />HRV<br />측정</button>
                      </div>
                      <p className="mh__type-sub">과(科) 공개 · 리듬 5일이면 동물 확정, HRV 4회면 수식어까지 (예: 매 · “출근 2시간 만에 오늘 일을 다 끝내는 사람”)</p>
                    </>
                  ) : (
                    /* ── 설문 전: 잠금 ── */
                    <>
                      <div className="mh__type-q" aria-hidden>?</div>
                      <div className="mh__type-title">나는 어떤 동물일까?</div>
                      <p className="mh__type-sub">설문 1분 × 키보드 리듬 × HRV로 찾는 내 업무 유형</p>
                    </>
                  )}

                  <div className="mh__type-code">
                    {[wtAxis1, '?', wtAxis3, '?'].map((c, i) => {
                      const ch = c ?? '?'
                      const tip = ch !== '?' ? WT_LETTER_DESC[ch] : i === 1 ? '부하 패턴(S/F) · 키보드 리듬 5일 이상 관찰 후 공개' : i === 3 ? '회복 탄력(R/G) · HRV 1분 측정 4회 이상 후 공개' : '설문을 하면 공개돼요'
                      return (
                        <span key={i} className={`mh__type-letter${ch !== '?' ? ' on' : ''}`} data-tip={tip}>
                          {ch}
                        </span>
                      )
                    })}
                  </div>
                  <p className="mh__type-hint">글자에 마우스를 올리면 뜻이 보여요</p>
                  <button type="button" className="mh__type-start" onClick={wtStart}>
                    {wtDone || wtAxis1 ? '🔁 설문 다시 하기' : '📋 1분 설문으로 시작하기'}
                  </button>
                  <ul className="mh__type-unlock">
                    <li><b>2</b> 부하 패턴 (S/F) · 키보드 리듬 5일 이상 관찰 · 진행 3/5일</li>
                    <li><b>4</b> 회복 여유 (R/G) · 1분 측정 4회 이상 · 진행 2/4회</li>
                  </ul>
                </div>

                {/* 2.5 퐁이 제안 — 패턴 기반 제안 + 실행 버튼 */}
                <div className="mh__card mh__rep-tip">
                  <p>🦊 퐁이 제안 · “요즘 수요일 오후 3시쯤 자주 바빠지시는 것 같아요. 그 시간 전에 미리 스트레스 알람을 당겨둘까요?”</p>
                  <div className="mh__tip-actions">
                    <button type="button" className="mh__tip-go" onClick={goAlarmSettings}>알람 당기기</button>
                    <button type="button" className="mh__tip-no">닫기</button>
                  </div>
                </div>
              </div>
            ) : mode === 'home' ? null : (
              /* ── ⚙️ 설정 탭 (별도 창 없음 — 미니홈에 통합) ── */
              <div className="mh__settings">
                <div className="mh__card" ref={alarmCardRef}>
                  <div className="mh__card-head">알람 간격</div>
                  <label className="mh__row">
                    물 목표(컵)
                    <input
                      type="number" min={1} max={20}
                      value={config.water.dailyTargetCups}
                      onChange={(e) => persist({ ...config, water: { ...config.water, dailyTargetCups: Math.min(20, Math.floor(Number(e.target.value)) || 0) } })}
                      onBlur={(e) => persist({ ...config, water: { ...config.water, dailyTargetCups: clampInt(e.target.value, 1, 20) } })}
                      onKeyDown={(e) => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                    />
                  </label>
                  <div className="mh__stat-row">오늘 마신 물 💧 <b>{waterToday}/{config.water.dailyTargetCups}</b>컵</div>
                  <label className="mh__row">
                    물 알림(분, 최소 20)
                    <input
                      type="number" min={20} max={240} step={10}
                      value={config.water.intervalMinutes}
                      onChange={(e) => persist({ ...config, water: { ...config.water, intervalMinutes: Math.min(240, Math.floor(Number(e.target.value)) || 0) } })}
                      onBlur={(e) => persist({ ...config, water: { ...config.water, intervalMinutes: clampInt(e.target.value, 20, 240) } })}
                      onKeyDown={(e) => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                    />
                  </label>
                  <span className="mh__nextalarm">⏰ 다음 물 · {nextWaterLabel()}</span>
                  {/* 스트레칭·휴식은 건강 펫의 기본 — 끌 수 없고 간격만 조절 */}
                  <label className="mh__row">
                    스트레칭 간격(분)
                    <input
                      type="number" min={10} max={360} step={10}
                      value={aux.stretchMin}
                      onChange={(e) => persist({ ...config, aux: { ...aux, stretchMin: Math.min(360, Math.floor(Number(e.target.value)) || 0) } })}
                      onBlur={(e) => persist({ ...config, aux: { ...aux, stretchMin: clampInt(e.target.value, 10, 360) } })}
                      onKeyDown={(e) => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                    />
                  </label>
                  <span className="mh__nextalarm">⏰ 다음 스트레칭 · {nextIntervalLabel(intake.lastStretchAt, aux.stretchMin)}</span>
                  <label className="mh__row">
                    휴식 간격(분)
                    <input
                      type="number" min={20} max={240} step={5}
                      value={aux.restMin}
                      onChange={(e) => persist({ ...config, aux: { ...aux, restMin: Math.min(240, Math.floor(Number(e.target.value)) || 0) } })}
                      onBlur={(e) => persist({ ...config, aux: { ...aux, restMin: clampInt(e.target.value, 20, 240) } })}
                      onKeyDown={(e) => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                    />
                  </label>
                  <span className="mh__nextalarm">⏰ 다음 휴식 · {nextIntervalLabel(intake.lastRestAt, aux.restMin)}</span>
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
                        <TimeSelect value={config.quietHours.start}
                          onChange={(v) => persist({ ...config, quietHours: { ...config.quietHours, start: v } })} />
                      </label>
                      <label className="mh__row">
                        끝나는 시간
                        <TimeSelect value={config.quietHours.end}
                          onChange={(v) => persist({ ...config, quietHours: { ...config.quietHours, end: v } })} />
                      </label>
                    </>
                  )}
                  <label className="mh__row">
                    <span className="mh__opacity-label">케어펫 투명도<br />(방해금지 중)</span>
                    <span className="mh__opacity">
                      <input type="range" min={20} max={100} step={5}
                        value={config.petOpacity ?? 40}
                        onChange={(e) => persist({ ...config, petOpacity: Number(e.target.value) })} />
                      <span className="mh__opacity-val">{config.petOpacity ?? 40}%</span>
                    </span>
                  </label>
                  <label className="mh__row">
                    펫 움직임 최소화
                    <input type="checkbox" checked={config.minimalMotion ?? false}
                      onChange={(e) => persist({ ...config, minimalMotion: e.target.checked })} />
                  </label>
                </div>

                {/* 약 등록·관리 — 설정 탭에서는 약지도에서 등록한 약 '목록·관리'만. 새 등록·입력은 약지도 탭에서만 */}
                <div className="mh__card">
                  <div className="mh__card-head">💊 약 등록 관리</div>
                  {config.medications.length > 0 ? (
                    <ul className="mh__meds mh__meds--manage">
                      {config.medications.map((m) => (
                        <li key={m.id}>
                          <span className="mh__med-info">
                            <span className="mh__med-text">
                              <span className="mh__med-name" title={m.name}>💊 {m.name}</span>
                              <small className="mh__med-time">
                                매일 {m.times.map(fmtTime).join(', ')}
                              </small>
                            </span>
                          </span>
                          {confirmDelId === m.id ? (
                            <span className="mh__med-delconf">
                              <button className="mh__med-del mh__med-del--yes" onClick={() => { persist(removeMed(config, m.id)); setConfirmDelId(null) }}>삭제</button>
                              <button className="mh__med-del" onClick={() => setConfirmDelId(null)}>취소</button>
                            </span>
                          ) : (
                            <span className="mh__med-manage">
                              {/* 수정 — 약 입력은 약지도 탭에서만. 수정도 약지도로 이동 */}
                              <button className="mh__med-edit" onClick={() => setMode('med')}>수정</button>
                              <button className="mh__med-del" onClick={() => setConfirmDelId(m.id)} aria-label={`${m.name} 삭제`}>🗑</button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mh__empty">아직 등록된 약이 없어요 — 약지도 탭에서 등록해보세요!</p>
                  )}
                  {/* + 새 약 등록 — 약지도 탭으로 이동(입력은 약지도에서만) */}
                  <button type="button" className="mh__med-addlink" onClick={() => setMode('med')}>
                    + 새 약 등록
                  </button>
                </div>



                <div className="mh__card">
                  <div className="mh__card-head">🪪 회원번호{copied && <span className="mh__copied" role="status">복사되었습니다</span>}</div>
                  <div className="mh__member">
                    <code>{config.memberId ?? '발급 중…'}</code>
                    <button
                      onClick={() => {
                        if (config.memberId) {
                          void navigator.clipboard?.writeText(config.memberId)
                          setCopied(true)
                          setTimeout(() => setCopied(false), 1500)
                        }
                      }}
                    >
                      복사
                    </button>
                  </div>
                  <p className="mh__guide-note">
                    기록·데이터 관리에 쓰는 나만의 고유번호예요.<br />이름이나 연락처와는 연결되지 않아요.
                  </p>
                </div>

                {/* ── 서비스 버전 (모든 사용자에게 표시) ── */}
                <div className="mh__card mh__ver">
                  <div className="mh__card-head">ℹ️ 서비스 버전</div>
                  <div className="mh__ver-row">
                    <span>현재 버전</span>
                    <code className="mh__ver-cur">v{version || '…'}</code>
                  </div>
                  {checkingUpdate ? (
                    <p className="mh__ver-note">최신 버전 확인 중…</p>
                  ) : update?.error ? (
                    <div className="mh__ver-status">
                      <p className="mh__ver-note">{update.error}</p>
                      <button className="mh__ver-retry" onClick={runUpdateCheck}>다시 확인</button>
                    </div>
                  ) : update && !update.isLatest ? (
                    <div className="mh__ver-status mh__ver-status--update">
                      <p className="mh__ver-note">새 버전 <b>v{update.latest}</b>이 나왔어요. 업데이트를 권장해요.</p>
                      {update.downloadUrl && (
                        <button className="mh__ver-dl" onClick={() => window.petApi.openExternal(update.downloadUrl as string)}>
                          ⬇ 최신 버전 다운로드
                        </button>
                      )}
                    </div>
                  ) : update ? (
                    <p className="mh__ver-note mh__ver-note--ok">✓ 최신 버전입니다</p>
                  ) : null}
                </div>

                {QA_MODE && (
                  <div className="mh__card mh__qa">
                    <div className="mh__card-head">🧪 QA 전용 <span className="mh__qa-tag">배포 빌드에선 숨김</span></div>
                    <p className="mh__guide-note">테스트용 강제 상태 변경 버튼이에요. 일반 사용자에게는 보이지 않아요.</p>
                    <div className="mh__qa-btns">
                      <button onClick={() => window.petApi.debug('gauge0')}>게이지 0</button>
                      <button onClick={() => window.petApi.debug('levelup')}>레벨업</button>
                      <button onClick={() => { window.petApi.debug('heartreset'); setLocalHearts(0) }}>하트 초기화</button>
                      <button onClick={() => window.petApi.debug('heartnext')}>방꾸미기 다음단계</button>
                      <button onClick={() => window.petApi.debug('togglechar')}>캐릭터 전환<br />(냥냥퐁↔용용퐁)</button>
                      <button
                        className="mh__qa-reset"
                        title="처음 설치처럼 — 데이터 수집 안내 + 랜덤 캐릭터 + 이름 설정부터 완전 초기화 (랜덤 캐릭터 확인용)"
                        onClick={() => {
                          if (confirm('처음 설치처럼 완전 초기화할까요?\n데이터 수집 안내가 다시 뜨고, 랜덤 캐릭터로 이름 설정부터 새로 시작해요.\n(누적기록·방꾸미기·도감 전부 리셋)')) {
                            window.petApi.debug('freshinstall')
                            setLocalHearts(0)
                          }
                        }}
                      >완전 초기화<br />(처음 설치처럼)</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* (우측 세로 책갈피 → 상단 가로 탭으로 이동. 아래 mh__toptabs 참조) */}
        </div>
      </div>

      {/* ── 업무유형 테스트 설문 모달(엑셀 ver.0.5) ── */}
      {wtStep !== null && (
        <div className="mh__wt-dim" onClick={wtClose}>
          <div className="mh__wt-modal" role="dialog" aria-label="업무유형 테스트" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mh__wt-x" onClick={wtClose} aria-label="닫기">✕</button>
            {typeof wtStep === 'number' ? (
              <>
                <div className="mh__wt-top">업무유형 테스트 · {wtStep + 1} / {WT_QUESTIONS.length}</div>
                <div className="mh__wt-axis">{WT_QUESTIONS[wtStep].axis}</div>
                <p className="mh__wt-q">{WT_QUESTIONS[wtStep].q}</p>
                <div className="mh__wt-opts">
                  {WT_QUESTIONS[wtStep].options.map((o) => (
                    <button key={o.letter} type="button" className="mh__wt-opt" onClick={() => wtPick(o.letter)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="mh__wt-top">업무유형 테스트 · 결과</div>
                <div className="mh__wt-result-title">첫 두 글자가 나왔어요!</div>
                <div className="mh__type-code mh__wt-code">
                  {[wtAxis1, '?', wtAxis3, '?'].map((c, i) => {
                    const ch = c ?? '?'
                    return (
                      <span key={i} className={`mh__type-letter${ch !== '?' ? ' on' : ''}`} data-tip={ch !== '?' ? WT_LETTER_DESC[ch] : undefined}>
                        {ch}
                      </span>
                    )
                  })}
                </div>
                <ul className="mh__wt-unlock">
                  <li><b>2번째 글자</b>는 키보드 리듬을 5일 지켜봐야 해요 · 느낌과 실제 패턴이 자주 다르거든요</li>
                  <li><b>4번째 글자</b>는 1분 측정 4회 · 여러 날 평균이어야 내 기준선이 생겨요</li>
                </ul>
                <button type="button" className="mh__wt-done" onClick={wtSeeCard}>결과 카드 보기</button>
                <button type="button" className="mh__wt-retry" onClick={wtStart}>설문 다시 하기</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── HRV 측정 모달(QR) — UI 껍데기, QR·측정 로직 추후 ── */}
      {hrvOpen && (
        <div className="mh__wt-dim" onClick={() => setHrvOpen(false)}>
          <div className="mh__hrv-modal" role="dialog" aria-label="HRV 측정" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mh__wt-x" onClick={() => setHrvOpen(false)} aria-label="닫기">✕</button>
            {/* QR 자리 — 추후 실제 QR 삽입 */}
            <div className="mh__hrv-qr" aria-label="QR 코드 자리" />
            <div className="mh__hrv-title">폰 카메라로 QR을 찍어주세요</div>
            <p className="mh__hrv-sub">손끝을 카메라에 1분간 · 끝나면<br />워크타입 네 번째 글자에 가까워져요</p>
            <div className="mh__hrv-count">측정 2/4회 · 하루 최대 2회</div>
            <button type="button" className="mh__wt-done mh__hrv-close" onClick={() => setHrvOpen(false)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  )
}
