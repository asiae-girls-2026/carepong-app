"""완화 P04·P05 + 공감챗(Route1). 1차는 /events/batch 의 relief_selected / relief_completed / relief_abandoned 로 (결정 A).
보상 상한(하루 3회·쿨다운 30분)은 앱 레이어 — 서버 팝업 정책(services/policy)과 별개 (결정 B)."""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(tags=["완화 (P04, P05)"])

class SessionAccepted(BaseModel):
    session_id: str = Field(..., examples=["rs_01"])
    accepted: bool = True

class ReliefSessionIn(BaseModel):
    kind: Literal["breath", "meditate", "chat"] = Field(..., description="chat = {펫이름}과 얘기하기 (Route1 전용, 보상 없음)")
    result: Literal["completed", "aborted", "declined"] = Field(..., description="declined=지금은 괜찮아요")
    started_at: datetime
    ended_at: datetime
    entry: Literal["stress_prompt", "mind_tab"] = Field(..., description="Route1(P03 감지, 선택지 3개: 심호흡·명상·대화) / Route2(M05 1분 쉬어가기, 선택지 2개)")
    window_id: str | None = Field(None, description="Route1 이면 과부하 창 ID (혜윤 보강 ★ 과부하→완화 연결). Route2 는 null")
    report_id: str | None = Field(None, description="Route1 이면 self-report 의 report_id")
    client_event_id: str

@router.post("/relief-sessions", status_code=201, response_model=SessionAccepted,
             summary="[Planned] 완화 세션 실시간 기록 — 1차는 /events/batch 의 relief_* 로 대체")
def relief(body: ReliefSessionIn):
    return SessionAccepted(session_id="rs_mock")
