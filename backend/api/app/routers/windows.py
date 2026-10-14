"""감지 — 1분 창 피처(16개) 업로드 → model 컨테이너 추론 → 팝업 정책(services/policy) 적용 → windows 테이블 저장 → 회신.
활동 0 창(SnKeyStrokes + SnMouseAct == 0)도 올린다 — 서버는 모델을 거치지 않고 condition_score=null 을 돌려주고 정책의 자리비움 계산에만 쓴다 (혜윤 Q17).
수집 시간은 방해금지 창 밖(08:30~18:30)만 — 앱이 수집기를 안 돌리므로 그 시간엔 창이 오지 않는다.
인증(토큰→user_id)은 D07 확정 후 Depends 로 교체. 지금은 헤더 X-User-Id (없으면 'dev') — 실데이터 수집 전 반드시 교체."""
from datetime import datetime
from fastapi import APIRouter, Header
from pydantic import BaseModel, Field
import json, logging
from ..services import policy, model_client, db
log = logging.getLogger("carepong.windows")

router = APIRouter(tags=["감지 (P03)"])
CUT_INTERVENE_DEFAULT = 63
FEATURES_16 = ["SnKeyStrokes", "SnChars", "SnSpecialKeys", "SnDirectionKeys", "SnErrorKeys", "SnShortcutKeys", "SnSpaces",
               "CharactersRatio", "ErrorKeyRatio", "SnMouseAct", "SnLeftClicked", "SnRightClicked", "SnDoubleClicked",
               "SnWheel", "SnDragged", "SnMouseDistance"]

class WindowIn(BaseModel):
    window_id: str = Field(..., max_length=64, examples=["win_01HZX…"], description="앱이 만든 창 ID(≤64자, UUID 가능). 라벨·예측을 이걸로 짝지음")
    session_id: str = Field(..., max_length=64, examples=["ses_01"], description="수집 세션(앱 실행 1회, ≤64자, UUID 가능)")
    window_start: datetime = Field(..., description="창 시작 시각 (앱 시계, KST). 자정 리셋·일 집계 기준")
    window_sec: int = Field(60, description="DA 확정 1분")
    features: dict[str, float | None] = Field(..., description="판정 16개만 (pillymon 변수명 그대로). 결측 null → 서버가 중앙값 대체. 그 외 키는 무시",
        examples=[{"SnKeyStrokes": 142, "SnChars": 110, "SnSpecialKeys": 9, "SnDirectionKeys": 4, "SnErrorKeys": 6, "SnShortcutKeys": 3,
                   "SnSpaces": 18, "CharactersRatio": 0.77, "ErrorKeyRatio": 0.05, "SnMouseAct": 38, "SnLeftClicked": 21,
                   "SnRightClicked": 2, "SnDoubleClicked": 1, "SnWheel": 14, "SnDragged": 0, "SnMouseDistance": 5120.5}])
    dnd: bool = Field(False, description="방해금지 중이면 true — 팝업 안 띄움")
    app_tab: str | None = Field(None, examples=["pet", "mind", "archive", "settings"],
                                description="이 창 동안 사용자가 있던 우리 앱 화면 (채원 app_category): pet=오버레이만 / mind·archive·settings=미니홈 탭 / null=앱 미사용. 탭별 이용·지수 상관용")
    client_event_id: str

class WindowOut(BaseModel):
    window_id: str
    condition_score: float | None = Field(None, ge=0, le=100, description="컨디션 지수 0~100 (소수 1자리, DA 산식 그대로). 활동 0 창·모델 실패 시 null")
    level: str = Field("unknown", examples=["normal", "observe", "intervene", "unknown"])
    prompt: bool = Field(False, description="true면 앱이 확인 팝업을 띄움")
    prompt_type: str = Field("none", examples=["morning", "spike", "random", "none"],
                             description="spike=과부하(30분 중 20분≥63, 1순위) · morning=첫 활동 30분 뒤 · random=고정 시간 보충(11:30/14:00/15:30/17:00). 모든 팝업 1시간 텀, 하루 5~8회. self-report 의 trigger 에 그대로")
    model_version: str = Field("unavailable", description="추론에 쓴 모델. 활동 0 창이면 skipped:activity0, 모델 서버 연결 실패면 unavailable")

class WindowBatchIn(BaseModel):
    windows: list[WindowIn] = Field(..., max_length=240, description="오프라인 복구용. 최대 240창(4시간). 팝업은 띄우지 않음")

def _activity(f: dict) -> float:
    return float(f.get("SnKeyStrokes") or 0) + float(f.get("SnMouseAct") or 0)

def _cut() -> int:
    return int((model_client.model_info() or {}).get("cut_intervene", CUT_INTERVENE_DEFAULT))

def _score(w: WindowIn) -> dict | None:
    if _activity(w.features) == 0:
        return None                                  # 활동 0 → 모델 안 거침 (Q17)
    feats = {k: w.features.get(k) for k in FEATURES_16}
    pred = model_client.predict(feats)
    return pred if pred and pred.get("score") is not None else None

def _out(w: WindowIn, pred: dict | None, ptype: str = "none") -> WindowOut:
    if pred is None:
        # 왜 null 인지 앱·테스트에서 바로 알 수 있게: 활동 0 창(정상) vs 모델 서버 연결 실패(장애)
        why = "skipped:activity0" if _activity(w.features) == 0 else "unavailable"
        return WindowOut(window_id=w.window_id, prompt=(ptype != "none"), prompt_type=ptype, model_version=why)
    return WindowOut(window_id=w.window_id, condition_score=pred["score"], level=pred["level"],
                     prompt=(ptype != "none"), prompt_type=ptype, model_version=pred["model_version"])

def _save(w: WindowIn, pred: dict | None, ptype: str, cp: str) -> None:
    """windows 1행 저장. DB 없으면 건너뜀. window_id·client_event_id 중복(재전송)은 무시.
    저장 실패는 로그만 남기고 응답은 정상 반환 — 팝업 판단이 저장 때문에 멈추면 안 됨."""
    if not db.available(): return
    try:
        uid = db.ensure_user(cp); db.ensure_session(w.session_id, uid, w.window_start)
        with db.conn() as c:
            c.execute("""INSERT INTO windows(window_id, user_id, session_id, window_start, window_sec, features, activity_zero, dnd, app_tab,
                           condition_score, prob, level, model_version, imputed, prompt_type, client_event_id)
                         VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                      (w.window_id, uid, w.session_id, w.window_start, w.window_sec,
                       json.dumps({k: w.features.get(k) for k in FEATURES_16}), _activity(w.features) == 0, w.dnd, w.app_tab,
                       pred["score"] if pred else None, pred.get("prob") if pred else None, pred["level"] if pred else None,
                       pred["model_version"] if pred else None, pred.get("imputed") if pred else None, ptype, w.client_event_id))
    except Exception as e:
        log.exception("windows 저장 실패 (%s): %s", w.window_id, e)

@router.post("/windows", response_model=WindowOut, summary="[Stub] 1분 창 업로드 → 서버 추론 → 지수·팝업 여부 회신")
def post_window(body: WindowIn, x_user_id: str = Header("dev")):
    pred = _score(body)
    st = policy.get_state(x_user_id)
    ptype = policy.decide(st, pred["score"] if pred else None, _activity(body.features), body.dnd, body.window_start, _cut())
    _save(body, pred, ptype, x_user_id)
    return _out(body, pred, ptype)

@router.post("/windows/batch", response_model=list[WindowOut], summary="[Stub] 창 여러 개 업로드 (복구 시, 최대 240). 팝업 없음")
def post_windows(body: WindowBatchIn, x_user_id: str = Header("dev")):
    st = policy.get_state(x_user_id); cut = _cut(); out = []
    for w in sorted(body.windows, key=lambda x: x.window_start):
        pred = _score(w)
        # 복구 업로드는 이력만 반영, 팝업은 안 띄움 (dnd=True 로 정책 호출)
        policy.decide(st, pred["score"] if pred else None, _activity(w.features), True, w.window_start, cut)
        _save(w, pred, "none", x_user_id)
        out.append(_out(w, pred))
    return out
