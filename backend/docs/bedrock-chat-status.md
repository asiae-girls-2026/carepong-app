# Bedrock 공감챗봇 — 현황 · 1차 배포 제외 결정 · 2차 연동 설계

작성 2026-10-13. 근거 문서: `공감챗봇_프롬프트_설계_Bedrock.pdf`(혜윤 10/13), `케어퐁_게임기획서_연우_10월13일.xlsx`, `CarePong_ML_…인계서_20261013.docx`, 이 저장소 `main`, carepong-app 소스.

## 결론 (10/14 아침 갱신)

- ~~1차 배포에 Bedrock 미포함~~ → **10/14 아침 팀 결정으로 1차에 포함.** 서버 `POST /v1/chat` + 앱 연결 구현 완료(아래 D). 10/13 밤 작성분은 기록으로 남김.
- 10/13 밤 콘솔 작업 완료: Claude Haiku 4.5(교차 리전) 활성화, 프롬프트 `carepong-empathy-v1` 버전 1 생성·ARN 전달.
- 혜윤 PDF의 지금 목표는 **Bedrock Prompt Management 1~5단계(콘솔에서 프롬프트 등록·테스트)**. 6단계(서버 연동)는 "분류모델·Electron 연결 후"로 PDF가 명시.
- 그 전제조건(모델 액세스 활성화 + IAM 권한)은 **AWS 계정 관리자 작업**이며 코드 변경이 없다. 아래 B 참고.

## 1. 세 문서 요약

| 문서 | 핵심 | 1차 배포와의 관계 |
|---|---|---|
| Bedrock 프롬프트 설계 PDF (혜윤) | 1차 = Bedrock 단독, 변수 `{{user_message}}` 하나. LLM이 긍정/부정 2갈래 자체 판단. 2차 = 분류모델 연결 후 `{{strategy}}` 8종 라우팅. temperature 0.7 · max 200토큰 | 서버·앱 변경 없음. AWS 계정 설정만 |
| 게임기획서 xlsx (연우 10/13) | 공감챗봇은 규칙 기반(Wizard-of-Oz). 시트13에서 "LLM 실연동" **미정**. 대화 원문 저장 안 함(기분 이모지만). "LLM 3줄 요약은 비용·프라이버시로 2차 보류" | 기획 자체가 1차에 LLM 없음 |
| ML 인계서 docx (10/13) | Bedrock 무관. raw(ev/wd) → `/v1/raw/batches` → S3 경로를 "운영 Backend 등록·테스트 PASS"로 기술. ⑤ "챗봇 텍스트는 별도 동의·보존 정책 수립" | ⚠ 아래 2-③ |

## 2. 코드 현황 (2026-10-13 확인)

1. **백엔드 `main`**: Bedrock·boto3·LLM·챗 엔드포인트 없음. `api/requirements.txt` 5개(fastapi/uvicorn/pydantic/httpx/psycopg). `routers/relief.py`의 `kind="chat"`은 "대화하기 선택" 기록용 [Planned] 스텁. 인증은 `X-User-Id` 헤더(검증 없음). `origin/feature/bearer-auth`(미병합)에 `services/auth.py`. AWS 자격증명·IAM 역할·`AWS_*` 환경변수 없음.
2. **앱**: `core/empathy.ts`가 챗봇 전체 — 위기 키워드(→ 109 / 1577-0199 안내) → 키워드 버킷 → 폴백. `renderer/ChatApp.tsx`의 `send()`가 `replyEmpathy(text)`를 렌더러에서 동기 호출. 서버엔 `chat_message{len, keyword_hit}`만 전송(원문 X). API 주소는 ALB **HTTP**(TLS 없음).
3. **⚠ 배포 전 확인 필요**: ML 인계서가 말하는 `/v1/raw/batches` + Bearer + S3 저장 코드가 이 저장소 `main`·`feature/bearer-auth` 어디에도 없다. EC2에 떠 있는 코드가 `main`과 다를 수 있으므로 배포 전 EC2에서 `git log -1`·`git status`·`docker compose ps`로 확인하고, 있으면 먼저 `main`에 합친다.

## 3. 1차 배포 제외 이유

- (a) 기획서가 LLM 연동을 '미정'으로 둠
- (b) 앱이 HTTP → 대화 원문이 평문으로 전송. 서버 정책 "원시 텍스트 어디에도 저장 안 함"(README, `events.py`) + 인계서 ⑤ 별도 동의 필요
- (c) 토큰 인증 미적용 → `X-User-Id` 위조로 남의 이름으로 LLM 호출·과금 가능
- (d) 혜윤 PDF가 서버 연동(6단계)을 "이후"로 둠

## B. AWS 콘솔에서 할 일 (계정 관리자, 코드 없음)

1. **Bedrock 모델 액세스** — 콘솔 → Amazon Bedrock → 리전 `ap-northeast-2`(서울) → Model access → Claude 계열 요청. 서울에 직접 없는 모델은 크로스리전 추론 프로필(`apac.anthropic.…`)로. 1차 테스트는 Haiku급부터 시작해도 됨. Prompt management 메뉴가 서울 리전에 보이는지 확인 — 없으면 `us-east-1` 등에서 프롬프트만 관리.
2. **혜윤용 IAM 사용자**(콘솔 로그인, MFA) — 최소권한: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `bedrock:Converse*`, `bedrock:*Prompt*`, `bedrock:ListFoundationModels`, `bedrock:GetFoundationModel`. 루트 계정 공유 금지.
3. (2차, 6단계 때) **Backend EC2 인스턴스 역할** — `bedrock:InvokeModel` + `bedrock:GetPrompt`를 해당 프롬프트 ARN·모델 ARN으로 한정. `.env`에 액세스 키 없이 boto3가 역할을 자동 사용.

완료 후 혜윤에게 받을 것: **프롬프트 ARN · 버전 번호 · 선택한 모델 ID**.

## C. 2차 서버 연동 설계 (결정만, 코드는 1차 안정 후)

- 경로: `ChatApp.tsx send()` → preload `chat` IPC 추가 → `main/api.ts` `postChat()`(기존 `call()` 재사용, 타임아웃 15초) → `POST /v1/chat` → `services/bedrock.py`가 boto3 `bedrock-runtime.converse(modelId=<프롬프트 ARN>, promptVariables={"user_message": …})` → 응답 텍스트만 반환.
- 서버 규칙: 대화 원문 **저장·로깅 금지**(길이·소요시간·모델ID만 `events`). 위기 키워드는 앱의 `isCrisis()`를 먼저 태워 LLM 호출을 건너뜀(현 안전 레이어 유지). Bedrock 실패 시 `replyEmpathy()` 규칙 응답으로 폴백. `BEDROCK_PROMPT_ARN` 미설정이면 503 → 플래그 하나로 on/off.
- 선행조건: ALB HTTPS(ACM), `feature/bearer-auth` 병합, 하루 메시지 상한(과금 캡), 챗 텍스트 외부 전송 고지(기획서 "모든 데이터 로컬" 문구 수정 — 연우 합의).
- 단일 워커 제약(README): Bedrock 호출은 `async` + `aioboto3` 또는 `run_in_threadpool` — 아니면 LLM 응답 1~3초 동안 `/v1/windows`가 막힘.

## D. 1차 연동 구현 (10/14)

- 서버: `api/app/services/bedrock.py`(Converse, `modelId`=프롬프트 ARN, `promptVariables.user_message`) + `api/app/routers/chat.py`(`POST /v1/chat`). `run_in_threadpool` 로 호출해 워커 1개에서 `/v1/windows` 를 막지 않음. 원문 로깅 없음(길이·지연·토큰 수만). 하루 상한 메모리 카운터.
- 앱: `main/api.ts postChat` → `main/index.ts` IPC `api:chat` → `preload careApi.chat` → `renderer/ChatApp.tsx send()`. 순서: `replyEmpathy()` 로 위기 판정 → 위기면 서버 미호출·고정 안내 / 아니면 서버 호출 → 실패·오프라인이면 규칙 응답 폴백. `chat_message` 이벤트에 `source: rule|bedrock` 추가.
- 환경변수(EC2 `.env`): `BEDROCK_PROMPT_ARN`(필수), `BEDROCK_REGION`(기본 ap-northeast-2), `CHAT_DAILY_MAX`(기본 30, 10/14 60→30). 자격증명은 raw.py 의 S3 와 같은 경로(인스턴스 역할 또는 `.env` 키)에 `bedrock:InvokeModel` + `bedrock:GetPrompt` + `bedrock:RenderPrompt` 추가 (RenderPrompt 가 빠지면 Converse 가 AccessDenied "Your account is not authorized to invoke this API operation with a prompt resource" — 10/14 실배포에서 확인).
- 남은 리스크(기록): ALB 가 HTTP 라 대화 원문 평문 전송, `X-User-Id` 미검증(하루 상한이 유일한 과금 캡), 기획서 "모든 데이터 로컬" 문구와 불일치 → 연우님 고지 문구 합의 필요.

### 배포 후 확인 (EC2 또는 아무 PC)
```
curl -s -X POST http://carepong-alb-405431408.ap-northeast-2.elb.amazonaws.com/v1/chat   -H "Content-Type: application/json" -H "X-User-Id: CP-TEST0001"   -d '{"message":"동료가 내 아이디어를 자기 거처럼 발표했어","client_event_id":"t1"}'
```
200 + 한국어 공감 답변이면 성공 (10/14 11시 실서버 확인: 3건 200, 1.8~2.1초, `model_id` 끝 `:1`). 503 이면 `.env` 의 ARN 누락 — `.env` 를 고친 뒤엔 `docker compose … up -d --force-recreate api` (restart 는 예전 env 를 그대로 씀). 502 면 IAM 권한·리전·ARN 오타 (api 로그 `carepong.bedrock` 경고에 원인 표시). 프롬프트 버전 교체는 ARN 끝 `:1` → `:2` 만 바꾸고 force-recreate.
