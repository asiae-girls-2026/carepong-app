"""모델 서빙 컨테이너 — 실제 추론 경로 (D03 서버 추론).
api 컨테이너가 /predict 를 호출한다. 앱은 이 컨테이너를 직접 부르지 않는다.
predict.py = 혜윤 제공 파일 그대로 (model_v1.json 내장, 표준 라이브러리만). 교체 시 predict.py 만 바꾸고 MODEL_VERSION 환경변수 올림.
검증: tests/validation_samples.json 5건 (혜윤 제공) — pytest 로 확인."""
from fastapi import FastAPI
from pydantic import BaseModel, Field
from predict import predict, FEATURES, MODEL_VERSION, CUT_INTERVENE, CUT_OBSERVE

app = FastAPI(title="CarePong Model API", version="0.2.0")

class PredictIn(BaseModel):
    features: dict[str, float | None] = Field(..., description="판정 16피처 (pillymon 변수명). 누락·null → 학습 중앙값 대치")

class PredictOut(BaseModel):
    score: float | None = Field(..., ge=0, le=100, description="컨디션 지수 0~100 (소수 1자리). 활동 0 창이면 null")
    prob: float | None = Field(..., ge=0, le=1, description="isotonic 보정 확률")
    raw_prob: float | None = None
    level: str | None = Field(..., examples=["normal", "observe", "intervene"])
    imputed: list[str] = Field(default_factory=list, description="중앙값으로 대치된 피처")
    model_version: str

@app.get("/health")
def health():
    return {"ok": True, "service": "model", "model_version": MODEL_VERSION,
            "features": len(FEATURES), "cut_report": CUT_OBSERVE, "cut_intervene": CUT_INTERVENE}

@app.post("/predict", response_model=PredictOut)
def predict_endpoint(body: PredictIn):
    feats = {k: v for k, v in body.features.items() if v is not None}   # null 은 빼서 중앙값 대치 경로로
    out = predict(feats)
    return PredictOut(score=out["score"], prob=out["prob"], raw_prob=out["raw_prob"], level=out["level"],
                      imputed=out["imputed"], model_version=MODEL_VERSION)
