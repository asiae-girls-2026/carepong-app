"""약 등록 관리 — 1차: 설정 ⚙️ 안 '약 등록 관리'(M07) + 약 알람(P02). 약지도 탭(M02~M04)·약 검색은 2차.
약 = 이름 + 시간 여러 개 + 반복 요일(기본 매일). LUI/폼 어느 쪽으로 등록해도 같은 API.
알람 응답(먹었어요/나중에/무응답)은 /events/batch 의 alarm_answered{kind: med} 로 흡수 (결정 A, 10/2)."""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(tags=["약 등록 관리 (M07, P02)"])

class MedicationIn(BaseModel):
    name: str = Field(..., examples=["오메가3"], description="사용자가 입력한 이름")
    times: list[str] = Field(..., examples=[["09:00", "19:00"]], description="HH:MM. LUI 어휘(아침·자기전 등)는 앱에서 변환해 보냄")
    repeat_days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6], description="반복 요일 0=월 … 6=일. 기본 매일")
    alias: str | None = Field(None, examples=["아침약"], description="별칭 (선택)")
    dose: str | None = Field(None, examples=["1정"], description="용량 (선택, 자유 텍스트)")
    memo: str | None = Field(None, examples=["식후"], description="📌 메모 (선택)")
    source: Literal["lui", "form"] = Field("form", description="등록 경로 — LUI vs GUI 비교 테스트용 (Q25: LUI 파서는 앱 안)")
    item_seq: str | None = Field(None, examples=["200808876"], description="식약처 품목기준코드 (정화 Q27). 2차 약 검색 연동 전까지 null")
    canonical_name: str | None = Field(None, description="DA 데이터셋에서 고른 정확 명칭 (연우 시트10). 연동 전 null")

class Medication(MedicationIn):
    medication_id: str = Field(..., examples=["med_01"])
    created_at: datetime

MOCK = [Medication(medication_id="med_01", name="오메가3", times=["19:00"], created_at=datetime(2026, 10, 1, 9, 0))]

@router.get("/medications", response_model=list[Medication], summary="[Stub] 등록 약 목록 (설정 관리 목록)")
def list_medications():
    return MOCK

@router.post("/medications", response_model=Medication, status_code=201, summary="[Stub] 약 등록 (LUI·폼 공통)")
def create_medication(body: MedicationIn):
    return Medication(medication_id="med_new", created_at=datetime.now(), **body.model_dump())

@router.put("/medications/{medication_id}", response_model=Medication, summary="[Stub] 약 수정 (시간·요일·용량·메모)")
def update_medication(medication_id: str, body: MedicationIn):
    return Medication(medication_id=medication_id, created_at=datetime(2026, 10, 1, 9, 0), **body.model_dump())

@router.delete("/medications/{medication_id}", status_code=204, summary="[Stub] 약 삭제")
def delete_medication(medication_id: str):
    return None

class LogAccepted(BaseModel):
    log_id: str = Field(..., examples=["mlog_01"])
    accepted: bool = True

class MedicationLogIn(BaseModel):
    scheduled_at: datetime = Field(..., description="원래 먹기로 한 시각")
    status: Literal["taken", "snoozed", "timeout"] = Field(..., description="taken=먹었어요 / snoozed=나중에(10분) / timeout=45초 무응답. 무응답≠미복용")
    occurred_at: datetime
    client_event_id: str

@router.post("/medications/{medication_id}/logs", status_code=201, response_model=LogAccepted,
             summary="[Planned] 약 알람 응답 실시간 기록 — 1차는 /events/batch 의 alarm_answered 로 대체")
def log_medication(medication_id: str, body: MedicationLogIn):
    return LogAccepted(log_id="mlog_mock")
