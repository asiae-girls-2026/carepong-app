import { describe, it, expect } from 'vitest'
import { isMeaningless } from './gibberish'

// gibberish_filter.py 의 __main__ 테스트 케이스 그대로 (막아야 하면 true)
const CASES: [string, boolean][] = [
  ['ㅁㅇㄴㄹ', true],
  ['ㅈㄷ9ㅁ려', true],
  ['ㅁㅇㄴㄹ ㅈㄷ9ㅁ려', true],
  ['ㄷㅈㄱㅂㅅㄷ', true],
  ['ㅋㅋㅋㅋ', false],
  ['ㅠㅠ', false],
  ['ㅎㅎ', false],
  ['ㅇㅇ', false],
  ['ㄱㅅ', false],
  ['오늘 야근 많아서 지쳐', false],
  ['배고파', false],
  ['응', false],
  ['회의가 또 잡혔어 진짜 지친다', false],
]

describe('gibberish isMeaningless (py 규칙 포팅)', () => {
  for (const [text, expected] of CASES) {
    it(`${JSON.stringify(text)} → 막음=${expected}`, () => {
      expect(isMeaningless(text)).toBe(expected)
    })
  }
})
