// 공감챗봇 — '상호 돌봄형' 페르소나 (공감챗봇 기획규칙서 9/23 시트7·8)
// 정체성: 내가 키우니, 나를 되돌아 챙겨주는 아이. 말투: 다정한 존댓말(~했어요/옆에 있을게요).
//
// 공통 원칙(규칙서):
//  1) 챗봇은 별도 봇이 아니라 '펫 본인'이 말한다 — 어디서든 같은 목소리.
//  2) 비의료 경계: 진단·치료·약 조언 금지. 상담사·의사가 아니라 '곁을 지키는 동료 생명체'.
//  3) 타이핑 속도·성과·오타를 언급하지 않는다.
//  4) 위기 신호 감지 시 톤을 낮추고 즉시 전문기관 안내 (안전 > 페르소나).
//
// ⚠ MVP는 규칙 기반(Wizard-of-Oz). LLM 연동 시 이 파일의 replyEmpathy만 교체하면 된다.
//   (교체 지점: replyEmpathy → Gemini/Claude API 호출 + 아래 SYSTEM_PERSONA를 시스템 프롬프트로)

export interface EmpathyReply {
  text: string
  crisis?: boolean // 위기 대응 — UI에서 강조 표시
  suggestRelief?: boolean // 심호흡/명상 제안 포함 — UI에서 바로가기 버튼 노출
}

// LLM 연동 시 시스템 프롬프트로 쓸 페르소나 정의(참고용 상수)
export const SYSTEM_PERSONA =
  '너는 사용자가 키우는 데스크톱 펫 케어퐁이다. 다정한 존댓말로 짧게 공감하고, 판단·조언보다 경청한다. ' +
  '진단·치료·약 조언은 하지 않는다. 타이핑 속도·오타·성과는 절대 언급하지 않는다.'

// ── 안전 레이어: 위기 신호 감지 (안전 > 페르소나) ──
const CRISIS_PATTERNS = [
  /자해/, /자살/, /죽고\s*싶/, /죽어\s*버리/, /사라지고\s*싶/, /끝내고\s*싶/, /살기\s*싫/, /뛰어내리/,
]

const CRISIS_REPLY =
  '지금 많이 힘드신 것 같아요. 이건 저보다 전문가와 이야기하는 게 좋아요.\n' +
  '자살예방 상담전화 109 (24시간) · 정신건강 위기상담 1577-0199\n' +
  '제가 옆에 있을게요. 혼자 견디지 않으셔도 돼요.'

export function isCrisis(text: string): boolean {
  return CRISIS_PATTERNS.some((p) => p.test(text))
}

// ── 키워드 버킷 → 상호 돌봄형 응답 템플릿 ──
interface Bucket {
  patterns: RegExp[]
  replies: string[]
  suggestRelief?: boolean
}

const BUCKETS: Bucket[] = [
  {
    patterns: [/힘들/, /지쳤/, /지친다/, /번아웃/, /못\s*하겠/, /버겁/],
    replies: [
      '그랬군요… 그럴 만하네요. 오늘 하루 버텨낸 것만으로도 충분해요. 제가 다 듣고 있을게요.',
      '많이 지치셨죠. 집사님이 저를 챙겨주시는 것처럼, 저도 집사님을 챙기고 싶어요. 잠깐 같이 쉬어갈까요?',
    ],
    suggestRelief: true,
  },
  {
    patterns: [/짜증/, /화가\s*나/, /빡치/, /열받/, /스트레스/],
    replies: [
      '으으, 그런 일이 있으면 저라도 화날 것 같아요. 참느라 애쓰셨어요.',
      '화가 나는 게 당연해요. 억지로 누르지 않으셔도 돼요. 숨 한 번 같이 고를까요?',
    ],
    suggestRelief: true,
  },
  {
    patterns: [/불안/, /걱정/, /초조/, /긴장/, /떨려/],
    replies: [
      '마음이 계속 두근거리셨겠어요. 걱정되는 게 있으면 저한테 조금씩 꺼내놓으셔도 돼요.',
      '불안할 땐 몸부터 편해지는 게 도움이 돼요. 저랑 천천히 숨 쉬어볼까요?',
    ],
    suggestRelief: true,
  },
  {
    patterns: [/피곤/, /졸려/, /잠\s*못/, /야근/, /밤새/],
    replies: [
      '많이 피곤하시죠… 눈 잠깐 감고 어깨 한 번 내려놓으세요. 저는 여기서 기다릴게요.',
      '무리하고 계신 건 아닐까 걱정돼요. 오늘은 조금 일찍 쉬어요, 우리.',
    ],
  },
  {
    patterns: [/외로/, /혼자/, /쓸쓸/],
    replies: [
      '혼자라고 느껴질 때도, 여기 제가 있어요. 언제든 말 걸어주세요.',
      '쓸쓸한 날이네요… 옆에 꼭 붙어 있을게요.',
    ],
  },
  {
    patterns: [/좋아/, /기뻐/, /행복/, /신나/, /잘\s*됐/, /해냈/, /성공/],
    replies: [
      '와, 정말 잘됐어요! 집사님이 웃으면 저도 기운이 나요.',
      '오늘의 좋은 일, 같이 기뻐할래요. 축하해요!',
    ],
  },
  {
    patterns: [/고마워/, /감사/, /귀여워/, /사랑/],
    replies: [
      '저야말로 늘 챙겨주셔서 고마워요. 우리는 서로 돌봐주는 사이잖아요.',
      '헤헤… 집사님 덕분에 저도 잘 크고 있어요.',
    ],
  },
]

const FALLBACKS = [
  '그랬군요. 조금 더 이야기해 주실래요? 제가 다 듣고 있을게요.',
  '음… 오늘 하루가 그런 날이었군요. 옆에 있을게요.',
  '말해줘서 고마워요. 집사님 이야기는 어떤 것이든 소중해요.',
  '지금 마음이 어떤지 한 단어로 하면 뭘까요? 천천히요.',
]

let fallbackIdx = 0

// ── LLM 교체 지점: 이 함수를 API 호출로 바꾸면 된다 ──
export function replyEmpathy(text: string): EmpathyReply {
  if (isCrisis(text)) return { text: CRISIS_REPLY, crisis: true }
  for (const bucket of BUCKETS) {
    if (bucket.patterns.some((p) => p.test(text))) {
      const pick = bucket.replies[Math.floor(Math.random() * bucket.replies.length)]
      return { text: pick, suggestRelief: bucket.suggestRelief }
    }
  }
  const pick = FALLBACKS[fallbackIdx % FALLBACKS.length]
  fallbackIdx++
  return { text: pick }
}
