"""라벨 — 팝업 응답 + 정기 체크인. 모델 vs 사용자 비교(M1)의 정답지.
필드는 혜윤 DA API명세서(10/2) '1_기본API' self-reports 그대로. 라벨↔창 매칭은 window_id.
팝업은 자동으로 안 닫힘 — 앱은 응답(answered)·닫기(dismissed)·다른 곳 클릭(ignored)·다음 팝업 때까지 무응답(pending) 중 하나를 꼭 보낸다."""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Header
from pydantic import BaseModel, Field
from ..services import db

router = APIRouter(tags=["감지 (P03)"])

class SelfReportIn(BaseModel):
    window_id: str | None = Field(None, max_length=64, description="팝업을 띄운 창 ID (/windows 응답의 window_id). 정기 체크인은 null")
    trigger: Literal["morning", "spike", "random", "checkin"] = Field(..., description="/windows 응답의 prompt_type 그대로 (random = 고정 시간 보충). checkin = 앱 자체 체크인")
    yesno: int | None = Field(None, ge=0, le=1, description="1=예 / 0=아니요 / null=무응답")
    level_1to5: int | None = Field(None, ge=1, le=5, description="[예] 후 1(여유)~5(매우). 안 물었으면 null")
    status: Literal["answered", "dismissed", "ignored", "pending"] = Field("answered",
        description="answered=O/X 응답 · dismissed=닫기 버튼 · ignored=다른 곳 클릭(포커스 이탈) · pending=응답 없이 다음 팝업 시각 도달")
    prompt_time: datetime | None = Field(None, description="팝업 뜬 시각 (앱 시계)")
    clicked_at: datetime | None = Field(None, description="뭔가 클릭한 시각 (O/X·닫기·무시). 무응답이면 null")
    latency_sec: int | None = Field(None, ge=0, description="clicked_at − prompt_time. 앱이 계산해 보내거나 null (서버가 계산)")
    question_version: str = Field("q1", description="문구 버전. 문구 바뀌면 올림")
    answered_at: datetime = Field(..., description="이 기록을 만든 시각 (앱 시계)")
    client_event_id: str

class SelfReportOut(BaseModel):
    report_id: str = Field(..., examples=["rep_01"])
    accepted: bool = True

@router.post("/self-reports", response_model=SelfReportOut, status_code=201, summary="[Stub] 팝업 응답(예/아니오·1~5·상태)·정기 체크인 기록")
def post_report(body: SelfReportIn, x_user_id: str = Header("dev")):
    if not db.available():
        return SelfReportOut(report_id="rep_nodb")
    uid = db.ensure_user(x_user_id)
    latency = body.latency_sec
    if latency is None and body.prompt_time and body.clicked_at:
        latency = int((body.clicked_at - body.prompt_time).total_seconds())
    with db.conn() as c:
        # window_id 가 아직 없는 창(순서 역전)이면 FK 위반 대신 null 로 저장
        wid = body.window_id
        if wid and not c.execute("SELECT 1 FROM windows WHERE window_id=%s", (wid,)).fetchone():
            wid = None
        row = c.execute("""INSERT INTO self_reports(user_id, window_id, trigger, yesno, level_1to5, status, prompt_time, clicked_at,
                             latency_sec, question_version, answered_at, client_event_id)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT (client_event_id) DO UPDATE SET received_at = self_reports.received_at
                           RETURNING report_id""",
                        (uid, wid, body.trigger, body.yesno, body.level_1to5, body.status, body.prompt_time, body.clicked_at,
                         latency, body.question_version, body.answered_at, body.client_event_id)).fetchone()
    return SelfReportOut(report_id=str(row[0]))
