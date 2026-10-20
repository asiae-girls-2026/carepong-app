// 무의미 입력(자판 난타) 판별 필터 — 케어퐁 공감챗 전처리용
// 원본: gibberish_filter.py (서버·앱 공용 규칙) 를 TS로 포팅. 로직·상수 동일.
// 목적: "ㅁㅇㄴㄹ ㅈㄷ9ㅁ려" 같은 난타를 하트 적립 전에 거른다.
// 설계: 멀쩡한 말은 절대 막지 않는다(오탐 최소). 애매하면 통과.

const MIN_LEN = 2 // 공백 제거 후 이 미만이면 판단 보류(짧은 말은 통과)
const JAMO_RATIO_CUTOFF = 0.5 // 낱자 비율이 이 이상이면 난타 의심
const JAMO_RUN_CUTOFF = 4 // 낱자만으로 이 글자 수 이상이면 난타로 봄

// 감정표현 낱자(ㅋㅋㅋ, ㅠㅠ, ㅎㅎ, ㅜㅜ …) — 통과
const EMOTION_JAMO = new Set('ㅋㅎㅠㅜㅡㅗ')
// 자주 쓰는 인터넷 약어 — 통과
const ABBREV_WHITELIST = new Set([
  'ㅇㅇ', 'ㄴㄴ', 'ㄱㅅ', 'ㅇㅋ', 'ㅊㅋ', 'ㅂㅂ', 'ㅅㄱ', 'ㅎㅇ',
  'ㄷㄷ', 'ㅈㅅ', 'ㅇㄷ', 'ㄱㄱ', 'ㅇㅈ', 'ㄴㅇㄱ',
])

const RE_SYLLABLE = /[가-힣]/g // 완성형 한글(가~힣)
const RE_JAMO = /[ㄱ-ㅣ]/g // 낱자 자음·모음(ㄱ~ㅣ)
const RE_LATIN_DIGIT = /[A-Za-z0-9]/g

/** 무의미(난타) 입력이면 true. 파이썬 is_meaningless 의 bool 과 동일. */
export function isMeaningless(text: string | null | undefined): boolean {
  if (text == null) return true
  const s = text.trim()
  if (!s) return true

  const compact = s.replace(/\s+/g, '')

  // 1) 화이트리스트 약어 → 의미 있음
  if (ABBREV_WHITELIST.has(compact)) return false
  // 감정표현 낱자만(ㅋㅋㅋ, ㅠㅠ 등) → 의미 있음
  if (compact.length > 0 && [...compact].every((ch) => EMOTION_JAMO.has(ch))) return false

  // 2) 너무 짧으면 보류 → 통과(응/네/ㅇㅇ 보호)
  if (compact.length < MIN_LEN) return false

  // 3) 문자 종류 집계
  const n = compact.length
  const nSyllable = (compact.match(RE_SYLLABLE) ?? []).length
  const nJamo = (compact.match(RE_JAMO) ?? []).length
  const nLatin = (compact.match(RE_LATIN_DIGIT) ?? []).length

  // 4) 낱자만으로 긴 문자열(ㅁㅇㄴㄹ…) → 난타
  if (nJamo === n && n >= JAMO_RUN_CUTOFF) return true

  // 5) 낱자 비율이 높음(완성형 거의 없고 낱자가 흩뿌려짐) → 난타. 예 "ㅈㄷ9ㅁ려" = 3/6 = 0.5
  const jamoRatio = n > 0 ? nJamo / n : 0
  if (jamoRatio >= JAMO_RATIO_CUTOFF && n >= JAMO_RUN_CUTOFF) return true

  // 6) 의미 글자(완성형·영문/숫자)가 하나도 없음 → 난타
  if (nSyllable === 0 && nLatin === 0 && nJamo > 0) return true

  // 그 외 → 통과(정상, LLM이 처리)
  return false
}

/** 하트 적립 가능 여부 = 무의미하지 않은 메시지. (earnsHeart 교체용) */
export function earnsHeart(text: string): boolean {
  return !isMeaningless(text)
}
