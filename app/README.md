# 케어퐁 (CarePong)

직장인 스트레스 케어 데스크탑 펫 — **프로토타입 소스 인계본**.
키보드·마우스 리듬으로 스트레스를 실시간 감지해 1분 완화(심호흡·명상)로 잇고,
복약·수분·스트레칭·휴식 루틴을 펫 육성(XP·만렙 환생)으로 챙긴다.

> ⚠️ 이 코드는 **시연용 프로토타입**입니다. "실행되는 것처럼" 만드는 데 집중했고,
> 챗봇·요약은 규칙 기반(Wizard-of-Oz)입니다. 실서비스 전 보강 지점은 아래 "LLM 교체 지점"과
> `STATE.md`의 로드맵을 참고하세요.

## 시작하기

```bash
npm install     # 최초 1회
npm run dev     # 개발 실행 (바탕화면에 펫 등장)
npm test        # 단위 테스트 (vitest)
npm run typecheck
npm run dist:win   # 윈도우 설치본(NSIS) → release/
npm run dist:mac   # 맥 zip → release/
```

- 첫 실행 시 이름짓기 프롬프트가 뜹니다. 펫 **우클릭** = 돌봄 메뉴, **미니홈 🏠** = 메인 허브.
- 종료: 메뉴바(맥)/트레이(윈도우) → 종료.

## 꼭 읽을 문서 (docs/)

| 문서 | 내용 |
|---|---|
| `STATE.md` (루트) | **진행상황·구현 전체 요약 — 여기부터** |
| `docs/케어퐁_화면기획서_..._ver.0.6.pptx` | 화면기획서 (전 화면 SB·정책) |
| `docs/케어퐁_게임규칙서_....xlsx` | 게이지·XP·알람·개입 수치 전부 |
| `docs/케어퐁_디자인에셋리스트_....xlsx` | 제작 필요 에셋(캐릭터 재제작·GIF 등) |
| `docs/IA.md` | 창·탭 구조도 |
| `docs/테스트설계_LUI_vs_GUI_약등록.md` | 약 등록 UX 비교 테스트 설계 |

## 구조

```
src/
├─ main/        # Electron 메인: 창 2종·트레이·메뉴·OS알림·스트레스 매니저(stress.ts)·저장소(store.ts)
├─ preload/     # contextBridge — petApi / careApi만 노출
├─ core/        # 순수함수 게임·도메인 로직 (UI 무관, vitest 대상)
│   ├─ progression.ts  # 레벨·XP·만렙 환생 (CREATURES 순환)
│   ├─ care.ts / intake.ts / health.ts / scheduler.ts  # 돌봄·알람 4종·설정
│   ├─ stress.ts       # 감지 산식 (60초 창·가중치·EMA)
│   ├─ empathy.ts      # 공감챗봇 (페르소나·위기 안전 레이어)
│   ├─ medLui.ts       # 약 등록 LUI 파서 (시간 어휘 사전)
│   └─ drugData.ts     # 약 설명 (e약은요 폴백 목업)
└─ renderer/
    ├─ App.tsx         # 바탕화면 오버레이 (펫·알람·개입·환생)
    ├─ ChatApp.tsx     # 미니홈 (약지도/마음관리/아카이브/설정 4탭)
    └─ ReliefOverlay.tsx  # 심호흡(숨결 버블)·명상
```

## 핵심 정책 (코드에 반영된 것)

- **무압박**: 죽음·벌점 없음. 게이지 0 = 시무룩 표현만. 스트레스 지수 UI 비노출(개입 프롬프트만)
- **클릭 정책**: 약 알람만 응답 전까지 클릭 획득(모달). 물·스트레칭·휴식은 클릭통과 유지, 말풍선 호버 시에만 버튼 활성
- **개입 상한**: 하루 3회 + 쿨다운 30분 (`src/main/stress.ts`)
- **프라이버시**: 키·마우스 내용 미수집(리듬·횟수만), 전 데이터 로컬. 회원번호 `CP-XXXXXXXX` = 익명 조인 키
- **스트레칭·휴식 알람은 끌 수 없음** — 간격만 조절 (건강 펫 원칙)

## LLM 교체 지점 4곳 (현재 규칙 기반)

1. `core/empathy.ts` → `replyEmpathy()` — 공감 응답
2. `core/drugData.ts` — 약 설명 생성
3. `core/medLui.ts` — 등록 파서 (tool-calling 치환 권장)
4. `renderer/ChatApp.tsx` → `summarizeDay()` — 일기 요약

## 개발·QA 콘솔 치트 (UI에서 제거됨)

개발자도구 콘솔에서:
```js
petApi.debug('xp100' | 'maxout' | 'rebirth' | 'heal' | 'sad')
careApi.setDemo(true)   // 스트레스 시뮬레이션 (10초 내 개입 발동)
```

## 저장소

- electron-store `care-pong`: pet(레벨·세대·역대 펫·하트) / config(스케줄·방해금지·회원번호) / intake(기록·순응률)
- 미니홈 localStorage: `carepong-diary`(마음 일기)

## 남은 일 (인계 기준)

LLM 실연동(4지점) · 서버/수집 파이프라인(person_id 조인) · 전역 키보드 마커(macOS 권한) ·
캐릭터 아트 전면 재제작(디자인 에셋 리스트) · 수치 플레이 테스트 · 코드 서명(맥 공증·윈도우)

---
기획·프로토타입: 박채원 (xoxouxui@gmail.com)
