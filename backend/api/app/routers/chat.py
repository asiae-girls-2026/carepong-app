"""공감챗 (M05 마음관리 챗) — 앱이 사용자 메시지 1건을 보내면 Bedrock 프롬프트(services/bedrock)로 답변 생성.
1차(10/14): 대화 이력 없이 1건 단발. 위기 키워드는 앱(core/empathy.ts isCrisis)이 먼저 걸러 서버에 안 보낸다.
서버가 503/502/429 를 주면 앱은 기존 규칙 기반 replyEmpathy 로 폴백 — 사용자에겐 끊김 없음.
원문 저장·로깅 없음. 이벤트 집계는 앱이 기존대로 /events/batch 의 chat_message{len, keyword_hit, source} 로.
하루 상한(CHAT_DAILY_MAX, 기본 30/사용자)은 과금 캡 — 메모리 카운터(워커 1개 전제, policy 상태와 같은 방식)."""
import os, logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from ..services import bedrock

log = logging.getLogger("carepong.chat")
router = APIRouter(tags=["공감챗 (M05)"])

KST = timezone(timedelta(hours=9))
DAILY_MAX = int(os.environ.get("CHAT_DAILY_MAX", "30"))
_daily: dict[str, tuple[str, int]] = {}   # user → (KST 날짜, 오늘 호출 수)

class ChatIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=500, examples=["동료가 내 아이디어를 자기 거처럼 발표했어"],
                         description="사용자 입력 원문. 서버는 저장·로깅하지 않고 Bedrock 에만 전달")
    client_event_id: str = Field(..., description="앱이 만든 고유 ID (재전송 추적용)")

class ChatOut(BaseModel):
    reply: str = Field(..., description="펫 답변 (2~4문장, 프롬프트가 보장)")
    source: str = Field("bedrock", examples=["bedrock"], description="답변 출처. 앱 폴백 시엔 앱이 'rule' 로 기록")
    model_id: str = Field("", description="Bedrock 프롬프트 ID (버전 포함)")
    latency_ms: int = 0

def _count(user: str) -> int:
    today = datetime.now(KST).strftime("%Y-%m-%d")
    d, n = _daily.get(user, (today, 0))
    n = n + 1 if d == today else 1
    _daily[user] = (today, n)
    return n

@router.post("/chat", response_model=ChatOut, summary="[1차] 공감챗 1건 → Bedrock 프롬프트 응답",
             responses={503: {"description": "BEDROCK_PROMPT_ARN 미설정 — 앱은 규칙 응답으로 폴백"},
                        502: {"description": "Bedrock 호출 실패(권한·시간초과) — 앱 폴백"},
                        429: {"description": "하루 상한 초과 — 앱 폴백"}})
async def chat(body: ChatIn, x_user_id: str = Header("dev")):
    if not bedrock.enabled():
        raise HTTPException(503, "chat disabled")
    if _count(x_user_id) > DAILY_MAX:
        raise HTTPException(429, "daily limit")
    r = await run_in_threadpool(bedrock.reply, body.message)   # 워커 1개 — /windows 를 막지 않게 스레드에서
    if r is None:
        raise HTTPException(502, "bedrock unavailable")
    log.info("chat ok len=%d latency=%dms in=%s out=%s", len(body.message), r["latency_ms"],
             r["usage"].get("inputTokens"), r["usage"].get("outputTokens"))
    return ChatOut(reply=r["text"], model_id=r["model_id"], latency_ms=r["latency_ms"])
