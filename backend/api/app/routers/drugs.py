"""약 정보 — 2차. 식약처 e약은요(의약품)·I0030(건강기능식품)를 서버가 대신 호출 → API 키는 서버 환경변수(DATA_GO_KR_KEY)에만.
응답 모양은 정화 Q24 답(성분·상호작용·근거를 배열로 분리) 기준. 1차엔 안 쓰임."""
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter(tags=["약 정보 (2차)"])

class DrugInfo(BaseModel):
    item_seq: str = Field(..., examples=["200808876"], description="식약처 품목기준코드 — 등록 시 medications.item_seq 로 저장")
    name: str
    company: str
    efficacy: str
    usage: str
    caution: str
    ingredients: list[str] = Field(default_factory=list, description="성분 (정화 Q24)")
    interactions: list[str] = Field(default_factory=list, description="상호작용·DUR 경고 (정화 Q24)")
    sources: list[str] = Field(default_factory=list, description="RAG 근거 (정화 Q24)")

@router.get("/drugs/search", response_model=list[DrugInfo], summary="[Planned] 약 이름으로 e약은요 검색 (서버 프록시) — 2차")
def search(q: str = Query(..., min_length=1, examples=["타이레놀"])):
    return [DrugInfo(item_seq="000000000", name=f"{q}정", company="(목)", efficacy="두통·발열 완화", usage="1회 1정", caution="과량 복용 주의")]

@router.get("/supplements/search", response_model=list[DrugInfo], summary="[Planned] 건강기능식품 검색 (I0030) — 2차 (정화)")
def search_supplements(q: str = Query(..., min_length=1, examples=["오메가3"])):
    return []
