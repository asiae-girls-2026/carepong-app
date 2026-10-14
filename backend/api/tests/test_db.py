"""DB 저장 통합 테스트 — DATABASE_URL 이 있을 때만 실행 (없으면 skip).
로컬: docker compose up 후  DATABASE_URL=postgresql://carepong:carepong@localhost:5432/carepong pytest tests/test_db.py"""
import os, pytest
pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL 없음")
from fastapi.testclient import TestClient
from app.main import app
from app.services import model_client, db

H = {"X-User-Id": "CP-PYTEST01"}

@pytest.fixture(scope="module")
def client(monkeypatch_module=None):
    model_client.predict = lambda f: {"score": 70.0, "prob": 0.7, "level": "intervene", "model_version": "v1", "imputed": []}
    model_client.model_info = lambda: {"cut_intervene": 63}
    with TestClient(app) as c:
        assert db.available()
        with db.conn() as con:
            con.execute("DELETE FROM self_reports WHERE user_id IN (SELECT user_id FROM users WHERE cp_number=%s)", ("CP-PYTEST01",))
            con.execute("DELETE FROM events WHERE user_id IN (SELECT user_id FROM users WHERE cp_number=%s)", ("CP-PYTEST01",))
            con.execute("DELETE FROM windows WHERE user_id IN (SELECT user_id FROM users WHERE cp_number=%s)", ("CP-PYTEST01",))
        yield c

def _win(c, i, ks=100):
    return c.post("/v1/windows", headers=H, json={"session_id": "ses_t", "window_id": f"wt_{i}", "window_start": f"2026-10-07T10:{i:02d}:00+09:00",
                                                  "features": {"SnKeyStrokes": ks, "SnMouseAct": 0}, "client_event_id": f"wt_{i}"})

def test_window_saved_and_idempotent(client):
    assert _win(client, 1).json()["condition_score"] == 70.0
    assert _win(client, 1).status_code == 200                      # 재전송
    assert _win(client, 2, ks=0).json()["condition_score"] is None  # 활동 0
    with db.conn() as con:
        rows = con.execute("SELECT window_id, activity_zero FROM windows WHERE session_id='ses_t' ORDER BY window_id").fetchall()
    assert rows == [("wt_1", False), ("wt_2", True)]

def test_self_report_latency_and_missing_window(client):
    r = client.post("/v1/self-reports", headers=H, json={"window_id": "wt_1", "trigger": "spike", "yesno": 1, "status": "answered",
        "prompt_time": "2026-10-07T10:01:05+09:00", "clicked_at": "2026-10-07T10:01:40+09:00", "answered_at": "2026-10-07T10:01:41+09:00", "client_event_id": "rt_1"})
    assert r.status_code == 201
    r2 = client.post("/v1/self-reports", headers=H, json={"window_id": "no_such", "trigger": "checkin", "answered_at": "2026-10-07T11:30:00+09:00", "client_event_id": "rt_2"})
    assert r2.status_code == 201
    with db.conn() as con:
        rows = con.execute("SELECT window_id, latency_sec FROM self_reports WHERE client_event_id IN ('rt_1','rt_2') ORDER BY client_event_id").fetchall()
    assert rows == [("wt_1", 35), (None, None)]

def test_events_batch_saved_rejects_unknown(client):
    ev = lambda n, i: {"client_event_id": i, "event": n, "screen": "P01", "occurred_at": "2026-10-07T09:00:00+09:00", "props": {"type": "feed"}, "app_version": "0.1.0"}
    r = client.post("/v1/events/batch", headers=H, json={"events": [ev("care_action", "et_1"), ev("made_up", "et_2"), ev("care_action", "et_1")]})
    assert r.json() == {"accepted_ids": ["et_1", "et_1"], "rejected_ids": ["et_2"]}
    with db.conn() as con:
        assert con.execute("SELECT count(*) FROM events WHERE client_event_id='et_1'").fetchone()[0] == 1
