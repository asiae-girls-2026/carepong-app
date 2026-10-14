# 케어퐁 backend-service

Windows 데스크톱 케어펫 **케어퐁(CarePong)** 의 서버. 1차 베타 10/7 → 2차 10/26.
구조: `api`(FastAPI 메인) · `model`(FastAPI 추론, DA 모델) · `collector`(입력 수집기, Electron 자식 프로세스) · `infra`(Docker Compose·Caddy).

## 폴더

```
backend-service/
├ api/           메인 API. app/routers/ 화면별 주소, app/services/policy.py 팝업 정책, services/db.py, migrations/*.sql, tests/
├ model/         추론 서버. predict.py = 혜윤 제공 파일 그대로 (model_v1.json 내장). tests/validation_samples.json 5건으로 검증
├ collector/     pynput 전역 후킹 → 1분 피처 16개 → JSON stdout. PyInstaller 로 exe
├ infra/         docker-compose.yml(api·model·db) + docker-compose.aws.yml(EC2 오버라이드: api:80, RDS)
└ docs/          api-changelog.md · db-tables.md · client/(앱 전달물)
```

## 켜기

```
docker compose -f infra/docker-compose.yml up --build
```

| 주소 | 뭐가 보이나 |
|---|---|
| http://localhost:8000/docs | Swagger. 직접 눌러보며 테스트 |
| http://localhost:8000/health | `{"ok": true}` |
| http://localhost:8001/health | 모델 컨테이너 (model_version·컷) |

켜지면 api 가 `migrations/*.sql` 을 자동 적용해 테이블 12개를 만든다 (설계: `docs/db-tables.md`). `DATABASE_URL` 이 없거나 DB 가 안 뜨면 **저장 없이** 동작한다(로그에 경고).

Docker 없이: `cd api && pip install -r requirements.txt && uvicorn app.main:app --reload`
테스트: `cd api && pytest` / `cd model && pytest` / `cd collector && pytest`
DB 통합 테스트: compose 켠 뒤 `DATABASE_URL=postgresql://carepong:carepong@localhost:5432/carepong pytest api/tests/test_db.py`

## 데이터 흐름 (10/2 확정)

| 길 | 주기 | 주소 | 비고 |
|---|---|---|---|
| 감지 피처 16개 | **1분마다 실시간** (08:30~18:30, 활동 0 창 포함) | `POST /v1/windows` | 서버 추론 → `condition_score`·`prompt`·`prompt_type` 회신. 활동 0 창은 null |
| 팝업 응답·체크인 | 즉시 | `POST /v1/self-reports` | `window_id` 로 예측과 짝. yesno + 1~5 |
| 이벤트(채원 마커 표) | **매일 08:30 또는 앱 시작 시** 묶음 | `POST /v1/events/batch` | 로컬 적재 → `accepted_ids` 만 삭제. 일 집계는 서버가 산출 |
| 설정·펫·약 백업 | 바뀔 때 | `/v1/routines` `/v1/pet` `/v1/medications` | 원본은 앱 로컬 |

서버가 "띄울지" 판단하는 팝업은 **과부하 확인 하나**(혜윤 DA 명세 3_동작규칙: 과부하 1순위 · 고정 보충 11:30/14/15:30/17 · 1시간 텀 · 하루 5~8회, `services/policy.py`). 복약·물·스트레칭·휴식 알림과 정기 체크인은 앱이 띄우고 서버는 기록만 받는다. 완화 보상 상한(3회·30분)도 앱.

## 엔드포인트 — 1차 [Stub] 15

| 메서드 | 주소 | 용도 |
|---|---|---|
| GET | /health | 생존 |
| POST | /v1/enroll | 앱이 만든 CP 번호 등록 → 토큰 |
| POST | /v1/windows · /v1/windows/batch | 1분 창 → 추론 → 팝업 여부 (배치 ≤240, 팝업 없음) |
| POST | /v1/self-reports | 팝업 응답(예/아니오·1~5)·체크인 |
| POST | /v1/events/batch | 이벤트 묶음 (이벤트명은 채원 마커 표 고정) |
| GET/POST/PUT/DELETE | /v1/medications[/{id}] | 설정 안 약 등록 관리 |
| GET/PUT | /v1/routines | 알람 간격·방해금지(18:30~08:30)·펫 투명도 |
| GET/PUT | /v1/pet | 펫 백업 (캐릭터 슬롯·레벨·하트·방꾸미기) |
| GET | /v1/config | 정책값 (컷·상한·방해금지·간격 기본값) |

2차 [Planned] 12: `/pet/actions` `/medications/{id}/logs` `/routines/logs` `/relief-sessions`(이벤트로 대체) · `/usage/daily`(GET, 서버 집계) · `/drugs/search` `/supplements/search` · `/telegram/*` · `/ppg/*`

## AWS 에 올리기 (정화 10/4 구성: EC2 1대 + RDS + ALB)

1. EC2(Ubuntu)에 Docker 설치, 저장소 clone
2. 저장소 루트에 `.env` 생성 — `DATABASE_URL=postgresql://<user>:<pw>@<rds-endpoint>:5432/carepong` (저장소에 올리지 않는다, `.gitignore` 됨)
   공감챗(10/14): `BEDROCK_PROMPT_ARN=arn:aws:bedrock:ap-northeast-2:<계정>:prompt/<id>:<ver>` 추가. EC2 인스턴스 역할(또는 `.env` 의 `AWS_ACCESS_KEY_ID/SECRET`)에 `bedrock:InvokeModel`·`bedrock:GetPrompt`·`bedrock:RenderPrompt` 권한(RenderPrompt 없으면 AccessDenied "not authorized … with a prompt resource"). 비우면 `/v1/chat` 503 → 앱 규칙 응답
3. `docker compose -f infra/docker-compose.yml -f infra/docker-compose.aws.yml up -d --build`
   → api 가 EC2:80 을 받고 켜지면서 RDS 에 마이그레이션 적용. model·db 포트는 외부에 안 열림
4. ALB: 타겟 EC2:80, 헬스체크 `/health`, TLS 는 ALB/ACM (Caddy 없음)
5. 앱의 `CAREPONG_API` 를 ALB DNS 이름으로

## 규칙

- 앱이 보내는 기록엔 전부 `client_event_id`. 재전송돼도 한 번만 기록
- 시각은 앱 시계(KST, ISO)로. 서버는 받은 시각을 따로 적는다
- 무응답(`timeout`)을 미복용으로 치지 않는다
- 주소·필드·이벤트명 바꾸려면 팀에 말하고 같이 바꾼다 (채원 마커 표·대시보드가 이름을 본다)
- 원시 키 코드·텍스트·창 제목은 어디에도 넣지 않는다
- 팝업 상태가 메모리에 있으므로 DB 이관(user_prompt_state) 전엔 **워커 1개, 배포는 08:30 전**

## 아직 결정 안 된 것

- 원시(raw) 보관: 혜윤 DB설계 = S3 저장 + `windows.raw_url` 포인터 (1차~2차). 수집기가 원시를 어디까지 남길지 1차 후
- D07 인증 (정화): `/enroll` 토큰 발급 + 라우터의 `X-User-Id` 헤더를 토큰 검증으로 교체. 지금은 헤더 값 = cp_number 로 users 를 찾음
- 복약 저장 로직 (정화): `routers/medications.py` — 테이블은 있음
- Q07 명명(스트레스→컨디션), Q08 팝업 문구
