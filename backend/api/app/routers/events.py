"""운영·검증 이벤트 — 채원 v0.6 마커 표(p.35)를 유일한 이벤트 체계로 (결정 A, 10/2).
앱은 이벤트를 로컬에 쌓았다가 **매일 08:30(방해금지 해제) 또는 앱 시작 시, 둘 중 먼저** 묶어서 보낸다.
서버가 돌려준 accepted_ids 만 로컬에서 지운다. 일 집계 지표는 서버가 여기서 산출한다 (앱이 /usage/daily 를 보내지 않음).
원시 키 코드·텍스트·창 제목은 어디에도 넣지 않는다."""
from datetime import datetime
import json, logging
from fastapi import APIRouter, Header
from pydantic import BaseModel, Field
from ..services import db

router = APIRouter(tags=["운영"])

# 1차 이벤트명 (채원 v0.6 p.35 + app_health). 바꾸려면 채원 표와 같이 바꾼다 — 대시보드가 이 이름을 본다.
EVENTS_1ST = {
    "app_start", "heartbeat", "app_quit", "app_health",
    "care_action", "dnd_toggle",
    "alarm_shown", "alarm_answered",
    "stress_prompt_shown", "stress_prompt_answered", "stress_score_answered",
    "relief_selected", "relief_completed", "relief_abandoned",
    "mood_checked", "chat_message",
    "med_register_started", "med_register_completed", "med_register_abandoned",
    "collector_toggle", "beta_upload", "water_goal_changed",
    "level_up", "rename", "rebirth",
    "collector_stopped", "inference_error",
    "tab_opened",          # 미니홈 탭 진입 {tab: mind|archive|settings} — 탭 이용 빈도 (채원 app_category 의도)
    "minihome_closed",     # 미니홈 창 닫힘 — 탭 체류시간 = 다음 tab_opened 또는 minihome_closed 까지
    "furniture_unlocked",  # 연우 G2 검증용 {stage: 1~9}. 하트는 이벤트 없음 — chat_message 수에서 산출, 누적은 putPet 스냅샷
}

class AppEvent(BaseModel):
    client_event_id: str = Field(..., description="앱이 만든 고유 ID. 재전송돼도 한 번만 기록")
    event: str = Field(..., examples=["alarm_answered"],
                       description="채원 v0.6 마커 표의 이벤트명. 목록 밖 이름은 rejected_ids 로 돌려줌. 1차 허용 목록: " + ", ".join(sorted(EVENTS_1ST)))
    screen: str | None = Field(None, examples=["P02"], description="화면 ID (P01~P08, M01~M07). 자동 이벤트는 null")
    occurred_at: datetime = Field(..., description="앱 시계 (로컬 TZ 포함 ISO)")
    props: dict = Field(default_factory=dict, examples=[{"kind": "med", "answer": "confirm"}],
                        description="마커 표의 props 그대로. 예: care_action{type: walk_refused}, app_health{cpu, mem, events_dropped, crash}")
    app_version: str = Field(..., examples=["0.1.0"])

class BatchIn(BaseModel):
    events: list[AppEvent] = Field(..., max_length=5000, description="하루치 묶음. 5,000건 넘으면 나눠서")

class BatchOut(BaseModel):
    accepted_ids: list[str] = Field(..., description="저장된 client_event_id — 앱은 이것만 로컬 큐에서 지움")
    rejected_ids: list[str] = Field(default_factory=list, description="거절된 ID (이벤트명 미등록 등)")

@router.post("/events/batch", response_model=BatchOut, summary="[Stub] 이벤트 일 1회 묶음 전송 (08:30 또는 앱 시작 시) — 중복 ID 무시")
def batch(body: BatchIn, x_user_id: str = Header("dev")):
    ok, bad = [], []
    for e in body.events:
        (ok if e.event in EVENTS_1ST else bad).append(e.client_event_id)
    if db.available() and ok:
        try:
            uid = db.ensure_user(x_user_id)
            rows = [(uid, e.client_event_id, e.event, e.screen, e.occurred_at, json.dumps(e.props), e.app_version)
                    for e in body.events if e.event in EVENTS_1ST]
            with db.conn() as c, c.cursor() as cur:
                cur.executemany("""INSERT INTO events(user_id, client_event_id, event, screen, occurred_at, props, app_version)
                                   VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""", rows)
        except Exception as e:
            logging.getLogger("carepong.events").exception("events 저장 실패: %s", e)
            return BatchOut(accepted_ids=[], rejected_ids=bad)   # 저장 안 됐으니 앱이 다음에 다시 보내게
    return BatchOut(accepted_ids=ok, rejected_ids=bad)
