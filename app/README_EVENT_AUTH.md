# 적용
CarePong_catalog_connected.zip의 app 폴더 기준 변경 파일 4개입니다. 캐릭터 이미지 파일은 포함하지 않습니다.
기존 app 폴더에 src를 합쳐 넣으세요. App.tsx를 다른 사람이 수정했다면 전체 덮어쓰기 대신 alarmProps, Reminder의 alarmId/shownAt, alarm_shown/alarm_answered 부분만 합치세요.

Windows PowerShell에서 app 폴더로 이동 후:
```
npm ci
npm run typecheck
npm run build
npm run dev
```
인증 토큰과 이벤트 큐는 기존 Electron userData에 보관합니다. 회원번호와 appId/productName은 변경하지 않았습니다. 사용자 데이터 폴더를 삭제하지 마세요.

# 서버 배포
백엔드 EC2에서 기존 작업을 확인하고 통합 브랜치에 인증을 합칩니다.
```
cd ~/backend-service
git status --short
git switch -c feature/event-auth-integration main
git merge feature/bearer-auth
```
충돌이 나오면 중단하고 파일 내용을 확인해야 합니다. 특히 main의 cp_number 검증과 인증 브랜치의 발급 로직을 모두 유지해야 합니다.
통합 브랜치를 push하고 GitHub PR로 main에 머지한 다음 EC2에서:
```
git switch main
git pull --ff-only origin main
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.aws.yml up -d --build api
```

# 현재 범위 및 제한
- 검색과 이벤트가 같은 ALB 기본 주소를 사용합니다. CAREPONG_API_BASE_URL 또는 CAREPONG_API로 덮어쓸 수 있습니다.
- 현재 ALB는 HTTP입니다. 토큰과 실사용자 복약 데이터를 전송하기 전 HTTPS 리스너/인증서/도메인을 구성하고 apiConfig.ts 주소를 HTTPS로 바꿔 재빌드하세요. HTTP에서는 건강 확인·비민감 검색만 검증하세요.
- POST /enroll과 GET /enroll, events/batch는 제공받은 인증 브랜치 필요.
- Windows/self-reports의 X-User-Id는 기존 서버 호환을 위해 cp_number로 유지. 모든 API가 Bearer 검증으로 전환된 상태는 아닙니다.
- 토큰은 OS safeStorage로 암호화 저장. OS 암호화가 없으면 발급하지 않음. 401/409에서는 회원번호/큐를 유지하고 로그에 복구 필요를 표시. 자동 재발급/만료/분실 복구는 서버에 아직 없으므로 구현했다고 간주하지 마세요.
- 기존에 RDS에 등록된 회원번호지만 토큰이 없는 사용자는 409가 발생합니다. 회원번호만으로 토큰을 재발급하면 사칭이 가능하므로 관리자 확인 등 별도 복구 절차가 필요합니다.
- 회원 등록 성공 후 응답을 잃으면 복구가 필요할 수 있습니다.
- 약 관리 API와 서버 약 ID 연동은 이번 패치에 포함하지 않았습니다.

# 복약 이벤트 props
alarm_shown: kind=med, alarm_id, shown_at, local_medication_id
alarm_answered: 위 필드 + answer=confirm|later|timeout
alarm_id는 알림 표시 1회마다 UUID. 반응은 같은 alarm_id를 사용. local_medication_id는 앱 로컬 ID이며 서버 약 ID가 아닙니다.
occurred_at/client_event_id/app_version은 main API 모듈에서 생성. 재전송 시 저장된 ID 유지.
timeout은 무응답이며 미복용으로 확정하는 값이 아닙니다.
약명은 이벤트 props에 추가하지 않았습니다. 정확한 scheduled_at은 기존 스케줄러가 제공하지 않아 포함하지 않았습니다.

# 검증
모의 서버: 토큰 재실행 재사용, Bearer 첨부, 503 큐 유지, accepted만 삭제, rejected 보관, 요청 중 추가 이벤트 보존 PASS.
전체 TypeScript 검사/Windows 실행/실제 ALB 전송/RDS 확인은 이 환경에서 실행하지 못했습니다.
배포 후 HTTPS 환경에서 새 테스트 회원 등록 → 복약 알림 표시/반응 → 앱 종료 시 batch 업로드 → RDS events의 사용자/props/client_event_id 확인 → 재실행 동일 회원번호·토큰 확인 → 같은 ID 재전송 1건 확인 순서로 검증하세요.
