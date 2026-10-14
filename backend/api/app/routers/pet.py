"""펫 P01·P06·P07 + 미니홈. 원본은 앱 로컬(electron-store). 서버는 백업 사본만.
보상(XP·게이지·하트) 계산은 앱. 행동 이벤트는 /events/batch 의 care_action{type} / level_up / rename / rebirth 로 (결정 A)."""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(tags=["펫 (P01, P06, P07, 미니홈)"])

class PetState(BaseModel):
    name: str = Field(..., examples=["퐁이"])
    character_slot: Literal[1, 2, 3] = Field(1, description="① 검정 고양이 ② 고양이+공룡 혼합 ③ 미정 (연우 시트7)")
    generation: int = Field(1, ge=1, description="N번째 친구 (문패)")
    level: int = Field(1, ge=1, le=5)
    xp: int = Field(0, ge=0, description="누적 XP (Lv5 = 5,400)")
    happiness: int = Field(70, ge=0, le=100)
    health: int = Field(70, ge=0, le=100)
    energy: int = Field(70, ge=0, le=100)
    hearts_total: int = Field(0, ge=0, description="누적 하트 (방꾸미기 진척, 자정 리셋 없음)")
    furniture_stage: int = Field(0, ge=0, le=9, description="방꾸미기 단계 0 빈방 ~ 9 장난감")
    updated_at: datetime

class Accepted(BaseModel):
    accepted: bool = True

class PetActionIn(BaseModel):
    action: Literal["feed", "pet", "walk", "walk_refused", "level_up", "rename", "rebirth"]
    occurred_at: datetime
    client_event_id: str
    detail: dict | None = Field(None, examples=[{"new_level": 2}])

@router.get("/pet", response_model=PetState, summary="[Stub] 펫 상태 (서버 백업본) 조회")
def get_pet():
    return PetState(name="퐁이", updated_at=datetime.now())

@router.put("/pet", response_model=PetState, summary="[Stub] 펫 상태 백업 (앱 → 서버)")
def put_pet(body: PetState):
    return body

@router.post("/pet/actions", status_code=201, response_model=Accepted,
             summary="[Planned] 행동 실시간 기록 — 1차는 /events/batch 의 care_action 등으로 대체")
def pet_action(body: PetActionIn):
    return Accepted()
