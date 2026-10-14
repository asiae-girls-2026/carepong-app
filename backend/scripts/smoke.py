#!/usr/bin/env python3
"""케어퐁 서버 스모크 테스트 — 표준 라이브러리만 사용 (pip 설치 불필요).

사용:
  python scripts/smoke.py http://localhost:8000
  python scripts/smoke.py http://carepong-alb-xxxx.ap-northeast-2.elb.amazonaws.com

검사 8개: 헬스 · 설정값 · 등록 · 혜윤 샘플 추론(점수 일치) · 활동0 창(null) · 중복 ID 멱등 ·
          라벨 저장 · 이벤트 배치(허용 3 + 미등록 1 → 거부). 전부 API 응답만으로 판정하므로 DB 접근 권한 없이 돌아간다.
테스트 데이터는 회원번호 CP-S<7자> 로 들어간다 (앱 발급 번호는 CP-<8자 hex>, 'S'+7자 패턴은 앱이 만들지 않으므로 구분됨. 정리: users 에서 cp_number LIKE 'CP-S%').
종료 코드 0 = 전부 통과, 1 = 실패 있음.
"""
import json, sys, time, uuid, urllib.request, urllib.error
for _s in (sys.stdout, sys.stderr):   # 윈도우 cp949 콘솔에서 ✅ 출력 시 UnicodeEncodeError 방지
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
from datetime import datetime, timezone, timedelta
from pathlib import Path

KST = timezone(timedelta(hours=9))
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
USER = f"CP-S{uuid.uuid4().hex[:7].upper()}"   # 실제 형식과 같은 11자 (CP-S 로 시작 = 스모크 데이터)
SESSION = str(uuid.uuid4())   # 앱(stress.ts)과 동일한 UUID 36자 — 001 의 varchar(32) 였으면 여기서 저장 실패가 드러난다 (004 에서 64로 확장)
HDR = {"Content-Type": "application/json", "X-User-Id": USER}
results = []


def call(method, path, body=None, headers=HDR, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers if body is not None else {"X-User-Id": USER})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {"_error": f"HTTP {e.code}"}
    except Exception as e:
        return None, {"_error": str(e)}   # 연결 실패 등 — dict 로 돌려서 .get() 이 항상 되게


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"  {'✅' if ok else '❌'} {name}" + (f"  — {detail}" if detail else ""))
    return ok


def now_iso(offset_min=0):
    return (datetime.now(KST) + timedelta(minutes=offset_min)).isoformat(timespec="seconds")


def window(features, offset_min=0, dnd=False):
    return {"window_id": str(uuid.uuid4()), "session_id": SESSION,   # 앱(api.ts uid())과 동일한 UUID 36자
            "window_start": now_iso(offset_min), "window_sec": 60, "features": features,
            "dnd": dnd, "app_tab": "home", "client_event_id": f"ce_{uuid.uuid4().hex}"}


print(f"케어퐁 스모크 테스트 → {BASE}   (사용자 {USER})")

# 1. 헬스
st, body = call("GET", "/health")
check("1 /health 200", st == 200 and isinstance(body, dict) and body.get("ok") is True, f"status={st} body={body}")
if st != 200:
    print("\n서버에 연결이 안 됨 — 주소·기동 상태 확인 후 다시 실행"); sys.exit(1)

# 2. 설정값
st, cfg = call("GET", "/v1/config")
check("2 /v1/config 정책값", st == 200 and cfg.get("cut_intervene") == 63 and cfg.get("prompt_gap_min") == 60,
      f"cut={cfg.get('cut_observe') if cfg else None}/{cfg.get('cut_intervene') if cfg else None} gap={cfg.get('prompt_gap_min') if cfg else None}")

# 3. 등록
st, enr = call("POST", "/v1/enroll", {"cp_number": USER, "device_id": "smoke-pc", "app_version": "0.0.0-smoke"})
check("3 /v1/enroll user_id·token", st == 200 and enr and enr.get("user_id") and enr.get("access_token"), f"status={st}")

# 4. 혜윤 검증 샘플 — 서버 점수가 혜윤 predict.py 기대값과 같은가 (model 컨테이너 살아있는지도 여기서 판별)
samples_path = Path(__file__).resolve().parent.parent / "model" / "tests" / "validation_samples.json"
samples = json.loads(samples_path.read_text(encoding="utf-8")) if samples_path.exists() else []
if samples:
    s = max((x for x in samples if x["expected"].get("score") is not None), key=lambda x: x["expected"]["score"])  # 점수 있는 샘플 중 최고점
    st, out = call("POST", "/v1/windows", window(s["input"], offset_min=-3))
    got = out.get("condition_score") if isinstance(out, dict) else None
    exp = s["expected"]["score"]
    check(f"4 /v1/windows 추론 = 혜윤 샘플 '{s['case']}'", st == 200 and got is not None and abs(got - exp) < 0.05 and out.get("level") == s["expected"]["level"],
          f"got={got} level={out.get('level') if isinstance(out, dict) else None} expected={exp} {s['expected']['level']} model_version={out.get('model_version') if isinstance(out, dict) else None}"
          + ("  ← score null 이면 model 서버 연결 실패(MODEL_URL 확인)" if got is None else ""))
else:
    check("4 혜윤 샘플 파일 없음 (model/tests/validation_samples.json)", False)

# 5. 활동 0 창 → null, 팝업 없음
zero = {k: 0 for k in ["SnKeyStrokes", "SnChars", "SnSpecialKeys", "SnDirectionKeys", "SnErrorKeys", "SnShortcutKeys", "SnSpaces",
                       "CharactersRatio", "ErrorKeyRatio", "SnMouseAct", "SnLeftClicked", "SnRightClicked", "SnDoubleClicked",
                       "SnWheel", "SnDragged", "SnMouseDistance"]}
st, out = call("POST", "/v1/windows", window(zero, offset_min=-2))
check("5 활동 0 창 → condition_score null · prompt false", st == 200 and out.get("condition_score") is None and out.get("prompt") is False,
      f"score={out.get('condition_score') if isinstance(out, dict) else out} prompt={out.get('prompt') if isinstance(out, dict) else None}")

# 6. 같은 client_event_id 두 번 → 둘 다 200 (서버가 거부하지 않고 DB 에서 한 번만 저장)
w = window(samples[0]["input"] if samples else zero, offset_min=-1)
st1, _ = call("POST", "/v1/windows", w); st2, _ = call("POST", "/v1/windows", w)
check("6 중복 client_event_id 재전송 → 200/200 (DB 1행, ON CONFLICT DO NOTHING)", st1 == 200 and st2 == 200, f"{st1}/{st2}")

# 7. 라벨
st, rep = call("POST", "/v1/self-reports", {"window_id": w["window_id"], "trigger": "spike", "yesno": 1, "level_1to5": 4,
                                            "status": "answered", "prompt_time": now_iso(-1), "clicked_at": now_iso(),
                                            "answered_at": now_iso(), "client_event_id": f"ce_{uuid.uuid4().hex}"})
check("7 /v1/self-reports 201 report_id", st == 201 and rep and rep.get("report_id"), f"status={st}")

# 8. 이벤트 배치 — 허용 3 + 미등록 1
ev = lambda name, **props: {"client_event_id": f"ce_{uuid.uuid4().hex}", "event": name, "screen": "P01",
                            "occurred_at": now_iso(), "props": props, "app_version": "0.0.0-smoke"}
bad = ev("not_a_real_event")
st, out = call("POST", "/v1/events/batch", {"events": [ev("app_start"), ev("tab_opened", tab="home"), ev("app_health", cpu=3, mem=120), bad]})
acc = out.get("accepted_ids", []) if isinstance(out, dict) else []
rej = out.get("rejected_ids", []) if isinstance(out, dict) else []
check("8 /v1/events/batch 허용 3 저장 · 미등록 1 거부", st == 200 and len(acc) == 3 and rej == [bad["client_event_id"]],
      f"accepted={len(acc)} rejected={len(rej)}" + ("  ← accepted 0 이면 DB 저장 실패(DATABASE_URL·migrations 확인)" if st == 200 and not acc else ""))

n_ok = sum(results)
print(f"\n{n_ok}/{len(results)} 통과" + ("  🎉 서버·모델·DB 전부 정상" if n_ok == len(results) else "  — ❌ 항목 확인 필요"))
sys.exit(0 if n_ok == len(results) else 1)
