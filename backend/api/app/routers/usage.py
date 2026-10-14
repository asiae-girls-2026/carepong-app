"""이용 지표 — 결정 A(10/2): 앱이 보내지 않는다. 서버가 /events/batch 에 쌓인 이벤트에서 일 단위로 산출한다.
항목은 연우 시트14-② 목록 (care_actions · walks · walks_refused · chat_messages · mood_checks · hearts_filled · med_taken · med_missed ·
water_count · stretch_count · rest_count · relief_offered · relief_accepted · relief_completed · pet_level · pet_generation ·
furniture_unlocked · days_to_next_character · active_minutes). 조회 API는 2차 (대시보드용)."""
from datetime import date
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(tags=["이용 지표"])

class DailyUsage(BaseModel):
    day: date
    care_actions: int = 0
    walks: int = 0
    walks_refused: int = 0
    chat_messages: int = 0
    mood_checks: int = 0
    hearts_filled: int = Field(0, ge=0, le=10)
    med_taken: int = 0
    med_missed: int = 0
    water_count: int = 0
    stretch_count: int = 0
    rest_count: int = 0
    relief_offered: int = 0
    relief_accepted: int = 0
    relief_completed: int = 0
    pet_level: int = Field(1, ge=1, le=5)
    pet_generation: int = Field(1, ge=1)
    furniture_unlocked: int = Field(0, ge=0, le=9)
    days_to_next_character: int | None = None
    active_minutes: int = 0

@router.get("/usage/daily", response_model=DailyUsage, summary="[Planned] 일별 이용 지표 조회 (서버가 이벤트에서 집계) — 2차")
def get_daily(day: date):
    return DailyUsage(day=day)
