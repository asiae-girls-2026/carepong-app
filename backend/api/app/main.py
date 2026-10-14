"""케어퐁 메인 API — 화면기획서 v0.6 + 앱 기획서(연우 10/2) 기준.
http://localhost:8000/docs 에서 Swagger로 확인.

상태 표기 규칙 (summary 접두어)
  [Stub]    일부 API의 임시 구현 표시. 실제 구현 여부는 각 라우터 기준으로 확인
  [Draft]   설계 미확정. 담당자 확정 대기
  [Planned] 1차 미포함. 2차(10/26~)에서 구현
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from .services import db
from .routers import (
    enroll,
    medications,
    routines,
    pet,
    relief,
    drugs,
    events,
    usage,
    windows,
    self_reports,
    config,
    telegram,
    ppg,
    da,
    catalog,
    chat,
    raw,
)


TAGS = [
    {
        "name": "운영",
        "description": "서버 생존 + 이벤트 묶음(채원 마커 표, 일 1회 08:30/앱 시작). 1.0",
    },
    {
        "name": "회원번호 (M07)",
        "description": "CP 번호 등록·토큰. 인증 방식(D07)은 확정 전이라 토큰 모양만 고정",
    },
    {
        "name": "제품 검색",
        "description": "의약품·건강기능식품 제품명 검색. 정확일치·부분일치·유사검색 지원.",
    },
    {
        "name": "설정 (M07)",
        "description": "알람 간격·방해금지(18:30~08:30 = 감지 제외 창)·펫 투명도. 1.0",
    },
    {
        "name": "펫 (P01, P06, P07, 미니홈)",
        "description": "펫 상태 백업(캐릭터·레벨·하트·방꾸미기). 보상 계산은 앱. 행동은 이벤트로. 1.0",
    },
    {
        "name": "완화 (P04, P05)",
        "description": "[Planned] 1차는 이벤트(relief_*)로 대체",
    },
    {
        "name": "약 정보 (2차)",
        "description": "[Planned] 식약처 e약은요·건기식 프록시. API 키는 서버만",
    },
    {
        "name": "이용 지표",
        "description": "[Planned] 서버가 이벤트에서 일 집계 (연우 시트14-②). 앱은 보내지 않음",
    },
    {
        "name": "감지 (P03)",
        "description": (
            "1분 창 업로드 → 서버 추론 → 지수·팝업 여부 회신. "
            "팝업 규칙 = 혜윤 DA 명세 3_동작규칙 "
            "(1시간 텀·고정 보충·하루 5~8회). 라벨 수집"
        ),
    },
    {
        "name": "모델 설정",
        "description": "앱 정책값(컷·상한·방해금지·간격 기본값). 가중치는 서버에만. 1.0",
    },
    {
        "name": "공감챗 (M05)",
        "description": (
            "마음관리 챗 1건 → Bedrock Prompt Management 프롬프트(혜윤 10/13 1차 단독 버전) 응답. "
            "원문 저장 없음. 503/502/429 면 앱이 규칙 응답으로 폴백. 1차(10/14)"
        ),
    },
    {
        "name": "텔레그램 봇",
        "description": "[Planned] 1차 제외 확정. 자리만",
    },
    {
        "name": "PPG 생체 층",
        "description": "[Planned] 2차. 과부하 팝업 [예] 시 QR, 하루 2회",
    },
    {
        "name": "DA 운영 (2차)",
        "description": "[Planned] 모델 교체·재학습 내보내기·개인 기준선·타임라인 (혜윤 DA 명세 2_추가API)",
    },
]


@asynccontextmanager
async def lifespan(app):
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    db.init()

    yield

    db.close()


app = FastAPI(
    lifespan=lifespan,
    title="CarePong API",
    version="0.2.0",
    description=(
        "케어퐁 서버 API 명세. "
        "summary 접두어 [Stub]/[Draft]/[Planned]로 상태 표시."
    ),
    openapi_tags=TAGS,
)


class Health(BaseModel):
    ok: bool = True
    service: str = "api"
    version: str = "0.1.0"


@app.get(
    "/health",
    tags=["운영"],
    summary="서버 생존 확인",
    response_model=Health,
)
def health():
    return Health(version=app.version)


for r in (
    enroll,
    #medications,
    routines,
    pet,
    relief,
    drugs,
    events,
    usage,
    windows,
    self_reports,
    config,
    telegram,
    ppg,
    da,
    catalog,
    chat,
    raw,
):
    app.include_router(r.router, prefix="/v1")
