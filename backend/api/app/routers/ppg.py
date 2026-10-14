"""생체 층 PPG — 틀만. 1차 제외(10/1). 2차: 과부하 팝업 [예] 시 QR, 하루 최대 2회 (연우 시트3).
DA 데모 흐름: 과부하 팝업 → QR(ID 포함, 하루 2회) → 폰 측정 웹 30초 → HRV 4피처 → 판정.
지금 측정 웹(Vercel)·서버(Render)·구글 시트는 DA 소유. 붙일 때 결정: 그대로 두고 결과만 받을지, 우리 서버로 흡수할지."""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(tags=["PPG 생체 층"])

class PpgSessionOut(BaseModel):
    session_id: str = Field(..., examples=["ppg_01"])
    qr_url: str = Field(..., description="앱이 QR로 그릴 측정 웹 주소. ID·세션 포함")
    expires_in_sec: int = 600
    daily_remaining: int = Field(2, description="하루 2회 제한")

class PpgResultIn(BaseModel):
    session_id: str
    measured_at: datetime
    mean_hr: float | None = None
    rmssd: float | None = None
    sdnn: float | None = None
    pnn50: float | None = None
    quality: Literal["good", "poor", "failed"] = "good"
    stress_prob: float | None = Field(None, ge=0, le=1, description="DA 생체 모델 출력")

@router.post("/ppg/sessions", response_model=PpgSessionOut, summary="[Planned] 측정 세션 생성 → QR 주소 발급")
def create_session():
    return PpgSessionOut(session_id="ppg_mock", qr_url="https://example.invalid/measure?s=ppg_mock")

class Accepted(BaseModel):
    accepted: bool = True

class LatestOut(BaseModel):
    session_id: str | None = None
    stress_prob: float | None = None

@router.post("/ppg/results", status_code=201, response_model=Accepted, summary="[Planned] 측정 결과 수신")
def post_result(body: PpgResultIn):
    return Accepted()

@router.get("/ppg/results/latest", response_model=LatestOut, summary="[Planned] 최근 측정 결과 조회")
def latest():
    return LatestOut()
