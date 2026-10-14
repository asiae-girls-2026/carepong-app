"""텔레그램 봇 — 틀만. 1차 제외 확정(10/2) — 2차에서 검토.
구조: 텔레그램 서버가 사용자 메시지를 우리 webhook으로 POST → 우리가 답장 API 호출.
지금은 받기만 하고 200 OK. 봇 토큰은 서버 환경변수(TELEGRAM_BOT_TOKEN)로만, 앱에 안 둠."""
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(tags=["텔레그램 봇"])

class PairingOut(BaseModel):
    pairing_code: str = Field(..., examples=["Q7K2-9FD3"], description="앱이 보여주고, 사용자가 봇에 /start Q7K2-9FD3 로 보냄")
    expires_in_sec: int = 600

@router.post("/telegram/pairings", response_model=PairingOut, summary="[Planned] 앱 ↔ 텔레그램 연결 코드 발급 (짧은 만료·1회용)")
def create_pairing():
    return PairingOut(pairing_code="MOCK-0000")

class Ok(BaseModel):
    ok: bool = True

@router.post("/telegram/webhook", response_model=Ok, summary="[Planned] 텔레그램 webhook 수신")
def webhook(update: dict, x_telegram_bot_api_secret_token: str | None = Header(None)):
    # TODO: secret 검증, update_id 중복 방지, /start <code> 처리, 체크인 답변 → self-reports
    return Ok()
