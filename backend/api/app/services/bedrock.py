"""Bedrock 공감챗 호출 — Prompt Management 에 등록한 프롬프트(혜윤 10/13 '1차 단독 버전')를 Converse API 로 실행.
프롬프트 본문·모델·temperature 는 Bedrock 콘솔 쪽에 있고 서버는 ARN 만 안다 (BEDROCK_PROMPT_ARN). 바꿀 때 서버 재배포 없음.
실패(권한·시간초과·리전)는 None 반환 → 호출 측(routers/chat.py)이 5xx 로 돌려주고 앱이 규칙 기반 응답으로 폴백.
자격증명은 boto3 기본 체인 (EC2 인스턴스 역할 또는 .env 의 AWS_ACCESS_KEY_ID/SECRET) — raw.py 의 S3 와 같은 자리에 bedrock:InvokeModel 권한 필요.
사용자 메시지 원문은 로그·DB 어디에도 남기지 않는다 (README 원칙)."""
import os, time, logging

log = logging.getLogger("carepong.bedrock")

PROMPT_ARN = os.environ.get("BEDROCK_PROMPT_ARN", "")
REGION = os.environ.get("BEDROCK_REGION", os.environ.get("AWS_REGION", "ap-northeast-2"))
CONNECT_TIMEOUT = float(os.environ.get("BEDROCK_CONNECT_TIMEOUT", "3"))
READ_TIMEOUT = float(os.environ.get("BEDROCK_READ_TIMEOUT", "12"))

_client = None

def enabled() -> bool:
    return bool(PROMPT_ARN)

def _get_client():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config
        _client = boto3.client("bedrock-runtime", region_name=REGION,
                               config=Config(connect_timeout=CONNECT_TIMEOUT, read_timeout=READ_TIMEOUT,
                                             retries={"max_attempts": 1}))
    return _client

def reply(user_message: str) -> dict | None:
    """프롬프트 변수 {{user_message}} 하나를 채워 호출. 성공 시 {text, model_id, latency_ms, usage}, 실패 시 None."""
    if not enabled():
        return None
    t0 = time.monotonic()
    try:
        r = _get_client().converse(
            modelId=PROMPT_ARN,
            promptVariables={"user_message": {"text": user_message}},
        )
        parts = r.get("output", {}).get("message", {}).get("content", [])
        text = "".join(p.get("text", "") for p in parts).strip()
        if not text:
            log.warning("bedrock 빈 응답 (stop=%s)", r.get("stopReason"))
            return None
        return {"text": text,
                "model_id": PROMPT_ARN.rsplit("/", 1)[-1],  # 프롬프트 ID (버전 포함 시 id:ver)
                "latency_ms": int((time.monotonic() - t0) * 1000),
                "usage": r.get("usage", {})}
    except Exception as e:  # botocore ClientError·EndpointConnectionError·ReadTimeoutError 모두 폴백
        log.warning("bedrock 호출 실패 (%s): %s", type(e).__name__, str(e)[:200])
        return None
