# 검색 API 연결 수정본

설정 → 약 등록·관리 → 검색어 입력 → 후보 클릭 → 시간 지정 → 등록.
선택한 제품의 item_type/product_id/external_id/manufacturer_name를 로컬 복약 목록에 저장합니다. 기존 등록의 ID, 회원번호, electron-store 경로, appId/productName은 변경하지 않았습니다. 기존 항목은 제품 ID가 없어도 계속 읽습니다.

검색은 Main에서 GET /v1/catalog/search?q=...&limit=20를 호출합니다. 기본 주소는 http://carepong-alb-405431408.ap-northeast-2.elb.amazonaws.com 입니다. 프로세스 환경변수 CAREPONG_API_BASE_URL로 바꿀 수 있습니다. .env 자동 로딩은 추가하지 않았습니다. 배포 주소를 영구 변경하려면 src/main/drugSearch.ts의 기본 주소를 수정 후 다시 빌드하세요.

Mock/식약처 직접 검색을 제거했습니다. 검색 중/빈 결과/접근 거부/서버 오류를 구분하고, 300ms 입력 지연과 오래된 응답 무시를 적용했습니다. 약 설명 대화는 기본 후보명만 반환하며 상세정보를 만들지 않습니다. 기존 대화 등록 버튼은 설정으로 이동합니다.

## Windows PowerShell 확인

```powershell
cd app
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

1. 타이레 입력 후 서버 후보 표시 확인. 오타 검색도 확인.
2. 선택 전 등록 불가 확인. 후보를 누른 후 이름을 바꾸면 선택이 해제되는지 확인.
3. 후보와 시간을 등록하고 앱 종료·재실행 후 목록 및 회원번호 유지 확인.
4. 인터넷 단절 시 오류 표시, Mock 후보가 나오지 않는지 확인.
5. 기존 등록 항목 및 알림 동작 확인.

```powershell
Invoke-RestMethod 'http://carepong-alb-405431408.ap-northeast-2.elb.amazonaws.com/v1/catalog/search?q=타이레&limit=3'
npm run dist:win
```

설치파일은 app/release에 생성됩니다. 기존 앱과 같은 사용자·설치 경로에서 업데이트 후 데이터 유지도 확인하세요. 저장소 설정 유지 여부만 소스로 확인했으며 실제 설치 업데이트 테스트는 하지 못했습니다.

## 검증 한계

작업 환경의 네트워크에서 ALB 요청과 npm 패키지 다운로드가 403으로 차단되어 실제 API 응답 및 타입 검사/빌드/실행을 검증하지 못했습니다. 이 403만으로 AWS 설정 오류라고 판단할 수 없습니다. 계약은 첨부 명세의 {items:[...]} 구조를 사용했습니다. 인증이 필요한 경우 현재 코드는 오류를 표시하며, 토큰 발급·저장 연동은 별도 작업입니다. 이벤트 마커/배치 전송/상세조회는 이번 변경 범위에 포함하지 않았습니다.
