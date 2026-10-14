"""DA 2차 주소 — 혜윤 DA API명세서 '2_추가API' (10/2). 전부 [Planned]. 모양만 잡아둠."""
from datetime import datetime, date
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(tags=["DA 운영 (2차)"])

class ModelVersionOut(BaseModel):
    model_version: str = Field(..., examples=["v1"])
    trained_at: datetime | None = None
    features: list[str] = Field(default_factory=list, description="16개")

class ReloadIn(BaseModel):
    model_url: str = Field(..., description="새 모델 파일 위치 (S3)")
    version: str

class BaselineOut(BaseModel):
    user_id: str
    feature_mean: list[float] = Field(default_factory=list)
    feature_std: list[float] = Field(default_factory=list)
    n_samples: int = Field(0, description="5개↑ 활성")

class Ok(BaseModel):
    ok: bool = True

@router.get("/model/version", response_model=ModelVersionOut, summary="[Planned] 서빙 모델 버전 조회 — 2차")
def model_version():
    return ModelVersionOut(model_version="v1")

@router.post("/model/reload", response_model=Ok, summary="[Planned] 모델 교체 (재배포 없이) — 2차")
def model_reload(body: ReloadIn):
    return Ok()

@router.get("/windows/export", summary="[Planned] 재학습용 창+라벨+완화 내보내기 (csv/json) — 2차")
def windows_export(user_id: str | None = None, from_: date | None = Query(None, alias="from"), to: date | None = None,
                   format: str = Query("json", pattern="^(csv|json)$")):
    return []

@router.get("/baseline/{user_id}", response_model=BaselineOut, summary="[Planned] 개인 기준선 (개인화) — 2차")
def baseline(user_id: str):
    return BaselineOut(user_id=user_id)

@router.get("/labels", summary="[Planned] 라벨 품질 필터 조회 (max_latency·status) — 1차 후")
def labels(max_latency: int | None = None, status: str | None = None):
    return []

@router.get("/user/{user_id}/timeline", summary="[Planned] 한 사람의 과부하·라벨·완화·복약 타임라인 — 2차")
def timeline(user_id: str, from_: date | None = Query(None, alias="from"), to: date | None = None):
    return []
