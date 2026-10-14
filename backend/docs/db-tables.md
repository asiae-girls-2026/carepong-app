# DB 테이블 설계 v1 — 2026-10-02

PostgreSQL 16. 근거: 혜윤 DB설계·API명세, 채원 마커 표 v0.6, 연우 시트14, 정화 Q27. 원본: `D:\Final_Pong\케어퐁_DB테이블설계_v1_20261002.xlsx`

## 테이블

| 테이블 | 단계 | 담당 | API | 용도 |
|---|---|---|---|---|
| `users` | 1차 | TA | POST /v1/enroll | 회원번호(앱 로컬 발급) 등록·토큰. 모든 테이블의 user_id 주인 |
| `sessions` | 1차 | TA·혜윤 | POST /v1/windows (session_id) | 수집 세션 = 앱 실행 1회. 파트별 세션 정의 통일 (혜윤 신설) |
| `windows` | 1차 | TA·혜윤 | POST /v1/windows, /v1/windows/batch | 1분 창 피처 16개 + 서버 추론 결과 + 팝업 판단. 라벨·완화의 매칭 키 |
| `self_reports` | 1차 | TA·혜윤 | POST /v1/self-reports | 팝업 응답·정기 체크인 라벨. windows 와 window_id 로 짝 (M1 정답지) |
| `events` | 1차 | TA·채원 | POST /v1/events/batch | 채원 마커 표 이벤트 1줄 = 1행. 일 집계·검증 대시보드·타임라인의 원천 |
| `daily_usage` | 1차 | TA·연우 | (서버 집계) GET /v1/usage/daily 2차 | 연우 시트14-② 일 집계 19개. 매일 08:30 배치 수신 후 서버가 events 에서 산출 |
| `user_medication` | 2차 (10/6 정화 설계로 교체) | 정화 | /v1/medications 2차 | 사용자 복용 등록. DRUG(med_product) 또는 HFF(hff_product) 중 하나 참조. 003 |
| `med_product` · `med_patient_info` · `hff_product` | 2차 (구조만 1차) | 정화 | GET /v1/catalog/search | 식약처 의약품·건기식 Catalog. 정화 파이프라인(Alembic)이 RDS 에 적재. 로컬은 003 이 동일 구조로 빈 테이블 생성 (`docs/db/carepong_product_schema.sql`) |
| `pet_state` | 1차 | TA·연우 | GET/PUT /v1/pet | 펫 백업 스냅샷 (사용자당 1행). 하트·방꾸미기 누적도 여기 |
| `routine_settings` | 1차 | TA·채원 | GET/PUT /v1/routines | 설정 백업 (사용자당 1행) |
| `user_prompt_state` | 1차 | TA | (내부) services/policy | 팝업 정책 상태 — 지금은 메모리, 재시작 시 초기화 문제 해결용 |
| `model_versions` | 2차 | 혜윤 | GET /v1/model/version, POST /reload | 모델 추적 (혜윤 DB설계) |
| `baselines` | 2차 | 혜윤 | GET /v1/baseline/{user_id} | 개인 기준선 (개인화) |

### users (1차)
회원번호(앱 로컬 발급) 등록·토큰. 모든 테이블의 user_id 주인. D07 인증 미정 → token_hash 는 토큰 방식 확정 후 채움

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| user_id | uuid | PK | N | 서버 발급 내부 ID |
| cp_number | varchar(12) | UQ | N | 앱 발급 CP-XXXXXXXX (person_id). 이름·연락처 연결 없음 |
| device_id | varchar(64) |  | N | 앱이 만든 기기 식별자 |
| app_version | varchar(16) |  | N | 등록 시 앱 버전 |
| os | varchar(16) |  | N | windows |
| token_hash | varchar(128) |  | Y | 액세스 토큰 해시 (D07 확정 후) |
| created_at | timestamptz |  | N | 서버 시각 |
| last_seen_at | timestamptz |  | Y | 마지막 요청 시각 |

### sessions (1차)
수집 세션 = 앱 실행 1회. 파트별 세션 정의 통일 (혜윤 신설). 앱이 session_id 를 만들고 첫 창에 실어 보냄. 서버가 없으면 생성

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| session_id | varchar(64) | PK | N | 앱 발급. 0.1.1 앱은 UUID 36자 (004 에서 32→64) |
| user_id | uuid | FK users | N |  |
| started_at | timestamptz |  | N | 첫 창 시각 (KST) |
| ended_at | timestamptz |  | Y | 마지막 창 시각 (갱신) |
| app_version | varchar(16) |  | Y |  |

### windows (1차)
1분 창 피처 16개 + 서버 추론 결과 + 팝업 판단. 라벨·완화의 매칭 키. 혜윤 DB설계: (user_id, window_start) 복합 인덱스 ★ / raw_url = S3 포인터(1차~2차). 활동 0 창도 저장(점수 null)

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| window_id | varchar(64) | PK | N | 앱 발급. 0.1.1 앱은 UUID 36자 (004 에서 32→64) |
| user_id | uuid | FK users | N |  |
| session_id | varchar(64) | FK sessions | N |  |
| window_start | timestamptz | IDX | N | 창 시작 (앱 시계, KST). 자정 리셋·일 집계 기준 |
| window_sec | smallint |  | N | 60 |
| features | jsonb |  | N | 판정 16개 {SnKeyStrokes:…}. 결측 null |
| activity_zero | boolean |  | N | SnKeyStrokes+SnMouseAct == 0 |
| dnd | boolean |  | N | 방해금지 중 |
| app_tab | varchar(12) |  | Y | 그 1분 동안 있던 우리 앱 화면 pet/mind/archive/settings (채원 app_category). 002 마이그레이션 |
| condition_score | numeric(4,1) |  | Y | 0~100.0. 활동0·모델실패 null |
| prob | numeric(6,4) |  | Y | isotonic 보정 확률 |
| level | varchar(10) |  | Y | normal/observe/intervene |
| model_version | varchar(16) |  | Y | v1 |
| imputed | text[] |  | Y | 중앙값 대치된 피처명 |
| prompt_type | varchar(10) |  | N | morning/spike/random/none — 서버 결정 |
| client_event_id | varchar(64) | UQ | N | 멱등키 |
| received_at | timestamptz |  | N | 서버 수신 시각 |
| raw_url | text |  | Y | 원시 타이밍 S3 경로 (2차) |

### self_reports (1차)
팝업 응답·정기 체크인 라벨. windows 와 window_id 로 짝 (M1 정답지). 혜윤 DB설계: window_id FK ★, latency_sec·status 로 라벨 품질 필터(2차 /labels)

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| report_id | uuid | PK | N | 서버 발급 |
| user_id | uuid | FK users | N |  |
| window_id | varchar(64) | FK windows | Y | 팝업 띄운 창. 체크인은 null |
| trigger | varchar(10) |  | N | morning/spike/random/checkin |
| yesno | smallint |  | Y | 1 예 / 0 아니요 / null 무응답 |
| level_1to5 | smallint |  | Y | [예] 후 1~5 |
| status | varchar(10) |  | N | answered/dismissed/ignored/pending |
| prompt_time | timestamptz |  | Y | 팝업 뜬 시각 |
| clicked_at | timestamptz |  | Y | 클릭 시각 |
| latency_sec | integer |  | Y | clicked_at − prompt_time (서버 계산) |
| question_version | varchar(8) |  | N | q1 |
| answered_at | timestamptz |  | N | 앱 시계 |
| client_event_id | varchar(64) | UQ | N | 멱등키 |
| received_at | timestamptz |  | N |  |

### events (1차)
채원 마커 표 이벤트 1줄 = 1행. 일 집계·검증 대시보드·타임라인의 원천. (user_id, occurred_at) 인덱스 ★ 교차분석 / (event, occurred_at) 인덱스. props 는 jsonb (relief_selected 의 window_id·report_id 도 여기)

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| event_id | bigserial | PK | N |  |
| user_id | uuid | FK users | N |  |
| client_event_id | varchar(64) | UQ | N | 멱등키 — 재전송 무시 |
| event | varchar(40) | IDX | N | 허용 목록 29종 (events.py EVENTS_1ST) |
| screen | varchar(8) |  | Y | P01~P08, M01~M07 |
| occurred_at | timestamptz | IDX | N | 앱 시계 (KST) |
| props | jsonb |  | N | 마커 표 props 그대로 |
| app_version | varchar(16) |  | N |  |
| received_at | timestamptz |  | N | 배치 수신 시각 |

### daily_usage (1차)
연우 시트14-② 일 집계 19개. 매일 08:30 배치 수신 후 서버가 events 에서 산출. 앱은 보내지 않음(결정 A). 일 경계 = 로컬 자정(KST). dnd 창 제외 규칙은 집계 로직에서 (혜윤 🟢)

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| user_id | uuid | PK·FK users | N |  |
| day | date | PK | N | KST 날짜 |
| care_actions | int |  | N | feed+pet+walk |
| walks | int |  | N |  |
| walks_refused | int |  | N |  |
| chat_messages | int |  | N | 상한 없음 |
| mood_checks | int |  | N |  |
| hearts_filled | smallint |  | N | 0~10 = min(chat_messages,10) |
| med_taken | int |  | N |  |
| med_missed | int |  | N | timeout/스누즈 후 미복용 |
| water_count | int |  | N |  |
| stretch_count | int |  | N |  |
| rest_count | int |  | N |  |
| relief_offered | int |  | N | stress_prompt_shown(spike) |
| relief_accepted | int |  | N | yesno=1 |
| relief_completed | int |  | N | relief_completed 이벤트 |
| pet_level | smallint |  | Y | pet_state 스냅샷 |
| pet_generation | smallint |  | Y |  |
| furniture_unlocked | smallint |  | Y | 0~9 |
| days_to_next_character | int |  | Y | 캐릭터 시작~Lv5 |
| active_minutes | int |  | N | 앱 포그라운드 분 (heartbeat 기반) |
| collector_active_min | int |  | N | 수집기 창 수 (활동0 포함) — 혜윤 구분 제안. 결손률 = 1 − 창수/활성분 |
| prompts_shown | smallint |  | N | 서버 팝업 수 (windows.prompt_type≠none) |
| computed_at | timestamptz |  | N |  |

### user_medication (2차 — 정화 설계, 003_user_medication.sql)
사용자 복용 등록. 10/6 정화 최신 복약·건기식 설계로 교체 (구 `medications` 테이블·`/v1/medications` 1차 제외). 원본은 앱 로컬, 서버는 사본.

| 컬럼 | 타입 | 제약 | NULL | 설명 |
|---|---|---|---|---|
| user_medication_id | bigserial | PK | N | |
| user_id | uuid | FK users | N | |
| item_type | varchar(20) | DRUG / HFF | N | 약 or 건강기능식품 |
| med_product_id | bigint | FK med_product | Y | item_type=DRUG 일 때 필수 |
| hff_product_id | bigint | FK hff_product | Y | item_type=HFF 일 때 필수 |
| start_date · end_date | date | end ≥ start | Y | 복용 기간 |
| dose_text | varchar(300) | | Y | 용량 자유 텍스트 |
| schedule_json | jsonb | | Y | 복용 시각·요일 |
| active | boolean | default true | N | |
| created_at · updated_at | timestamptz | | N | |

### med_product · med_patient_info · hff_product (Catalog — 정화 파이프라인)
운영 RDS 에는 정화 Alembic 파이프라인이 생성·적재. 백엔드 003 은 로컬·신규 DB 에만 같은 구조(`docs/db/carepong_product_schema.sql` = RDS pg_dump --schema-only)로 빈 테이블을 만든다 → 로컬 = RDS 구조.

| 테이블 | 주요 컬럼 | 비고 |
|---|---|---|
| med_product | med_product_id bigserial PK · item_seq varchar(30) UNIQUE · product_name varchar(300) · manufacturer_name · etc_otc_code · dosage_form · route · permit_date · permit_status · source_updated_at · synced_at | 식약처 의약품 제품 마스터. ix(product_name) |
| med_patient_info | med_product_id PK/FK(cascade) · efficacy_text · usage_text · warning_text · interaction_text · side_effect_text · storage_text | e약은요 환자용 설명 |
| hff_product | hff_product_id bigserial PK · prdlst_report_no varchar(50) UNIQUE · product_name · manufacturer_name · function_text · intake_method · caution_text · raw_material_text · synced_at | 건강기능식품. ix(product_name) |

`/v1/catalog/search` 는 `word_similarity` 를 쓰므로 `pg_trgm` 확장 필요 (003 에서 `CREATE EXTENSION IF NOT EXISTS`).

### pet_state (1차)
펫 백업 스냅샷 (사용자당 1행). 하트·방꾸미기 누적도 여기. 보상 계산은 앱. 서버는 최신값만 덮어씀

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| user_id | uuid | PK·FK users | N |  |
| name | varchar(12) |  | N |  |
| character_slot | smallint |  | N | 1~3 |
| generation | smallint |  | N | N번째 친구 |
| level | smallint |  | N | 1~5 |
| xp | int |  | N |  |
| happiness | smallint |  | N |  |
| health | smallint |  | N |  |
| energy | smallint |  | N |  |
| hearts_total | int |  | N | 누적 하트 |
| furniture_stage | smallint |  | N | 0~9 |
| updated_at | timestamptz |  | N | 앱 시계 |

### routine_settings (1차)
설정 백업 (사용자당 1행). 범위 밖 값은 API 가 422

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| user_id | uuid | PK·FK users | N |  |
| water_goal_cups | smallint |  | N | 8 |
| water_interval_min | smallint |  | N | 90 |
| stretch_interval_min | smallint |  | N | 60 |
| rest_interval_min | smallint |  | N | 75 |
| dnd_schedule_enabled | boolean |  | N | true |
| dnd_start | time |  | N | 18:30 |
| dnd_end | time |  | N | 08:30 |
| pet_opacity | smallint |  | N | 20~100 |
| pet_motion_minimal | boolean |  | N |  |
| updated_at | timestamptz |  | N |  |

### user_prompt_state (1차)
팝업 정책 상태 — 지금은 메모리, 재시작 시 초기화 문제 해결용. 창마다 갱신. 자정 리셋은 cur_date 비교로

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| user_id | uuid | PK·FK users | N |  |
| cur_date | date |  | Y |  |
| day_count | smallint |  | N |  |
| last_prompt_at | timestamptz |  | Y | 1시간 텀 기준 |
| first_activity_at | timestamptz |  | Y | 아침 기준선 |
| did_morning | boolean |  | N |  |
| ov_hist | smallint[] |  | N | 최근 30창 과부하 여부 |
| slots_done | text[] |  | N | 처리된 고정 슬롯 |
| updated_at | timestamptz |  | N |  |

### model_versions (2차)
모델 추적 (혜윤 DB설계). 1차는 생성 안 함

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| version | varchar(16) | PK | N |  |
| trained_at | timestamptz |  | Y |  |
| features | text[] |  | N | 16 |
| model_url | text |  | Y | S3 |
| active | boolean |  | N |  |

### baselines (2차)
개인 기준선 (개인화). 1차는 생성 안 함

| 컬럼 | 타입 | key | null | 설명 |
|---|---|---|---|---|
| user_id | uuid | PK·FK users | N |  |
| feature_mean | numeric[] |  | N | 16 |
| feature_std | numeric[] |  | N | 16 |
| n_samples | int |  | N | 5↑ 활성 |
| updated_at | timestamptz |  | N |  |

## 관계

| 부모 | 관계 | 자식 | 키 | 설명 |
|---|---|---|---|---|
| users | 1 : N | sessions · windows · self_reports · events · user_medication | user_id | 모든 테이블의 주인 |
| sessions | 1 : N | windows | session_id | 앱 실행 1회 = 세션. 세션별 조회 |
| windows | 1 : N | self_reports | window_id | ★ 라벨↔창 매칭 (M1). 체크인은 null |
| windows / self_reports | 1 : N | events (relief_selected props) | props.window_id · props.report_id | ★ 과부하→완화 연결 (혜윤 🔴). FK 아닌 jsonb 참조 — 2차에 relief_sessions 테이블로 승격 가능 |
| events | N → 1 | daily_usage | user_id + date(occurred_at) | 서버 집계 (매일 08:30 이후) |
| windows | N → 1 | daily_usage | user_id + date(window_start) | prompts_shown · collector_active_min |
| med_product / hff_product | 1 : N | user_medication | med_product_id / hff_product_id | item_type 에 따라 둘 중 하나 |
| med_product | 1 : 1 | med_patient_info | med_product_id | cascade |
| users | 1 : 1 | pet_state · routine_settings · user_prompt_state | user_id | 스냅샷·상태 |

## 인덱스

| 테이블 | 인덱스 | 용도 |
|---|---|---|
| windows | (user_id, window_start) | 복합 — 개인 시계열 조회 (혜윤 🔴 지금) |
| windows | (user_id, session_id) | 세션별 |
| windows | (client_event_id) UNIQUE | 멱등 |
| self_reports | (user_id, answered_at) |  |
| self_reports | (window_id) | FK 조회 |
| events | (user_id, occurred_at) | 교차 분석 (혜윤 🔴) |
| events | (event, occurred_at) | 대시보드 지표 |
| events | (client_event_id) UNIQUE | 멱등 |
| events | props GIN | 2차 — props 안 값 검색 시 |
| user_medication | (user_id) · (user_id, active) · (med_product_id) · (hff_product_id) | 003 |
