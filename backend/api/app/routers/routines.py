"""설정 M07 — 알람 간격·방해금지·펫. 원본은 앱 로컬, 서버는 백업 사본.
방해금지 창(1차 기본 18:30~08:30 자동) = 알람·개입 억제 + 스트레스 감지 제외까지 한 창으로 (결정 C, 10/2).
알람 이행(물·스트레칭·휴식)은 /events/batch 의 alarm_answered{kind} 로 (결정 A)."""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(tags=["설정 (M07)"])

class RoutineSettings(BaseModel):
    water_goal_cups: int = Field(8, ge=1, le=20, description="목표 도달 시 당일 물 알림 중단")
    water_interval_min: int = Field(90, ge=20, le=240)
    stretch_interval_min: int = Field(60, ge=10, le=240, description="끌 수 없음 — 간격만")
    rest_interval_min: int = Field(75, ge=20, le=240, description="끌 수 없음 — 간격만")
    dnd_schedule_enabled: bool = Field(True, description="1차 기본 ON (매일 자동)")
    dnd_start: str = Field("18:30", examples=["18:30"], description="HH:MM. 이 시각부터 알람·개입·감지 수집 중단")
    dnd_end: str = Field("08:30", examples=["08:30"], description="HH:MM. 1차 확정값 (연우 10/2)")
    pet_opacity: int = Field(100, ge=20, le=100, description="방해금지 중 펫 투명도 %")
    pet_motion_minimal: bool = False

class LogAccepted(BaseModel):
    log_id: str = Field(..., examples=["rlog_01"])
    accepted: bool = True

class RoutineLogIn(BaseModel):
    kind: Literal["water", "stretch", "rest"]
    status: Literal["done", "snoozed", "timeout"]
    occurred_at: datetime
    client_event_id: str

@router.get("/routines", response_model=RoutineSettings, summary="[Stub] 설정 조회")
def get_routines():
    return RoutineSettings()

@router.put("/routines", response_model=RoutineSettings, summary="[Stub] 설정 저장 (범위 밖 값은 422)")
def put_routines(body: RoutineSettings):
    return body

@router.post("/routines/logs", status_code=201, response_model=LogAccepted,
             summary="[Planned] 물·스트레칭·휴식 응답 실시간 기록 — 1차는 /events/batch 의 alarm_answered 로 대체")
def log_routine(body: RoutineLogIn):
    return LogAccepted(log_id="rlog_mock")
