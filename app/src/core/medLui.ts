// 약지도 LUI — 채팅으로 복약 스케줄 등록 (가이드 위저드 + 한 줄 명령 파싱)
// 프로토타입: 자유 파싱은 오인식이 많아 위저드를 기본 흐름으로, 한 줄 명령은 보조로 지원.
import type { MedTiming } from './scheduler'

export interface ParsedTime {
  time: string // "HH:MM"
  label: string // 사용자에게 보여줄 말 (예: 아침)
  timing?: MedTiming
}

// 시간 표현 → 시각 (직장인 기준 점심 중심 — 기존 패널 정책과 동일)
const TIME_WORDS: [RegExp, ParsedTime][] = [
  [/아침/, { time: '09:00', label: '아침', timing: 'after_meal' }],
  [/점심/, { time: '13:00', label: '점심', timing: 'after_meal' }],
  [/저녁/, { time: '19:00', label: '저녁', timing: 'after_meal' }],
  [/(자기\s*전|취침|밤)/, { time: '22:00', label: '자기 전', timing: 'bedtime' }],
  [/공복|기상/, { time: '07:00', label: '기상 직후', timing: 'empty_stomach' }],
]

export function parseTimes(text: string): ParsedTime[] {
  const out: ParsedTime[] = []
  for (const [re, t] of TIME_WORDS) {
    if (re.test(text)) out.push(t)
  }
  // "21시", "21:30", "9시 반" 형태
  const clock = text.matchAll(/(\d{1,2})\s*[:시]\s*(\d{2}|반)?/g)
  for (const m of clock) {
    const h = Number(m[1])
    if (h < 0 || h > 23) continue
    const min = m[2] === '반' ? 30 : Number(m[2] ?? 0) || 0
    const hh = String(h).padStart(2, '0')
    const mm = String(min).padStart(2, '0')
    out.push({ time: `${hh}:${mm}`, label: `${h}시${min ? ` ${min}분` : ''}` })
  }
  // 중복 시각 제거
  const seen = new Set<string>()
  return out.filter((t) => (seen.has(t.time) ? false : (seen.add(t.time), true)))
}

export interface OneShotRegister {
  name: string
  times: ParsedTime[]
}

// "유산균 아침 등록" / "타이레놀 9시에 등록해줘" 같은 한 줄 명령 감지
export function tryParseRegister(text: string): OneShotRegister | null {
  if (!/등록|추가|알람\s*맞춰|챙겨\s*줘/.test(text)) return null
  const times = parseTimes(text)
  // 시간·명령어 토큰을 걷어내면 남는 것이 약 이름
  const name = text
    .replace(/등록해?\s*줘?|추가해?\s*줘?|알람\s*맞춰\s*줘?|챙겨\s*줘?|매일|으로|에|좀|해줘/g, ' ')
    .replace(/아침|점심|저녁|자기\s*전|취침|밤|공복|기상/g, ' ')
    .replace(/(\d{1,2})\s*[:시]\s*(\d{2}|반)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name) return null
  return { name, times: times.length > 0 ? times : [{ time: '09:00', label: '아침(기본)', timing: 'after_meal' }] }
}

// 등록 완료 안내 문구
export function registerSummary(name: string, times: ParsedTime[]): string {
  const when = times.map((t) => `${t.label}(${t.time})`).join(', ')
  return `${name}, ${when} · 매일로 등록했어요! 💊 시간이 되면 바탕화면에서 제가 챙겨드릴게요. (약은 처방·약사 지시가 우선이에요)`
}
