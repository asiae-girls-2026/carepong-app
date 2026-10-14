"""/chat — 미설정 503, Bedrock 실패 502, 성공 통과, 하루 상한 429. 실행: cd api && pytest"""
from fastapi.testclient import TestClient
from app.main import app
from app.services import bedrock
from app.routers import chat as chat_router

client = TestClient(app)
BODY = {"message": "동료가 내 아이디어를 자기 거처럼 발표했어", "client_event_id": "c1"}

def test_disabled_without_arn(monkeypatch):
    monkeypatch.setattr(bedrock, "PROMPT_ARN", "")
    assert client.post("/v1/chat", json=BODY).status_code == 503

def test_bedrock_failure_502(monkeypatch):
    monkeypatch.setattr(bedrock, "PROMPT_ARN", "arn:test")
    monkeypatch.setattr(bedrock, "reply", lambda m: None)
    assert client.post("/v1/chat", json=BODY, headers={"X-User-Id": "u-fail"}).status_code == 502

def test_reply_passthrough(monkeypatch):
    monkeypatch.setattr(bedrock, "PROMPT_ARN", "arn:test")
    monkeypatch.setattr(bedrock, "reply", lambda m: {"text": "그랬구나, 많이 속상했겠다.", "model_id": "p1:1", "latency_ms": 420, "usage": {}})
    r = client.post("/v1/chat", json=BODY, headers={"X-User-Id": "u-ok"})
    assert r.status_code == 200
    j = r.json(); assert j["reply"].startswith("그랬구나") and j["source"] == "bedrock" and j["model_id"] == "p1:1"

def test_validation():
    assert client.post("/v1/chat", json={"message": "", "client_event_id": "c"}).status_code == 422
    assert client.post("/v1/chat", json={"message": "x" * 501, "client_event_id": "c"}).status_code == 422

def test_daily_limit(monkeypatch):
    monkeypatch.setattr(bedrock, "PROMPT_ARN", "arn:test")
    monkeypatch.setattr(bedrock, "reply", lambda m: {"text": "응", "model_id": "p", "latency_ms": 1, "usage": {}})
    monkeypatch.setattr(chat_router, "DAILY_MAX", 2)
    h = {"X-User-Id": "u-limit"}
    assert [client.post("/v1/chat", json=BODY, headers=h).status_code for _ in range(3)] == [200, 200, 429]
