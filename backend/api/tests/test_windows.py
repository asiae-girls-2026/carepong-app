"""/windows — 활동 0 창은 모델을 거치지 않고 null, 모델 실패 폴백, 배치 상한. 실행: cd api && pytest"""
from fastapi.testclient import TestClient
from app.main import app
from app.services import model_client

client = TestClient(app)
BASE = {"window_id": "w1", "session_id": "s1", "window_start": "2026-10-07T10:00:00+09:00", "client_event_id": "e1"}

def test_activity_zero_returns_null(monkeypatch):
    called = []
    monkeypatch.setattr(model_client, "predict", lambda f: called.append(f) or {"score": 70, "level": "intervene", "model_version": "v1"})
    r = client.post("/v1/windows", json={**BASE, "features": {"SnKeyStrokes": 0, "SnMouseAct": 0}})
    assert r.status_code == 200 and r.json()["condition_score"] is None and called == []

def test_model_failure_fallback(monkeypatch):
    monkeypatch.setattr(model_client, "predict", lambda f: None)
    r = client.post("/v1/windows", json={**BASE, "features": {"SnKeyStrokes": 10, "SnMouseAct": 3}})
    j = r.json(); assert j["model_version"] == "unavailable" and j["prompt"] is False

def test_prediction_passthrough(monkeypatch):
    monkeypatch.setattr(model_client, "predict", lambda f: {"score": 55, "level": "observe", "model_version": "v1"})
    monkeypatch.setattr(model_client, "model_info", lambda: {"cut_intervene": 63})
    r = client.post("/v1/windows", json={**BASE, "features": {"SnKeyStrokes": 10, "SnMouseAct": 3}}, headers={"X-User-Id": "t1"})
    assert r.json()["condition_score"] == 55

def test_batch_limit():
    ws = [{**BASE, "window_id": f"w{i}", "features": {"SnKeyStrokes": 0, "SnMouseAct": 0}} for i in range(241)]
    assert client.post("/v1/windows/batch", json={"windows": ws}).status_code == 422

def test_events_rejects_unknown_name():
    ev = lambda n, i: {"client_event_id": i, "event": n, "occurred_at": "2026-10-07T09:00:00+09:00", "props": {}, "app_version": "0.1.0"}
    r = client.post("/v1/events/batch", json={"events": [ev("alarm_answered", "a"), ev("made_up", "b")]})
    assert r.json() == {"accepted_ids": ["a"], "rejected_ids": ["b"]}
