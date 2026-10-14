"""팝업 정책 v2 — 혜윤 DA 명세 3_동작규칙. 실행: cd api && pytest"""
from datetime import datetime, timedelta
from app.services import policy
from app.services.policy import PromptState, decide, KST

def day(start="09:00", minutes=570, score=40, overload=()):
    """09:00 부터 1분 창. overload=[(시작분, 끝분)] 구간은 지수 70. 반환 [(시각, 종류)]"""
    h, m = map(int, start.split(":")); t0 = datetime(2026, 10, 7, h, m, tzinfo=KST)
    st = PromptState(); out = []
    for i in range(minutes):
        now = t0 + timedelta(minutes=i)
        s = 70 if any(a <= i < b for a, b in overload) else score
        p = decide(st, s, 1, False, now, 63)
        if p != "none": out.append((now.strftime("%H:%M"), p))
    return out, st

def test_quiet_day_gives_exactly_five():
    out, st = day()
    assert out == [("09:30", "morning"), ("11:30", "random"), ("14:00", "random"), ("15:30", "random"), ("17:00", "random")]
    assert st.day_count == policy.DAILY_MIN

def test_overload_is_first_priority_and_resets_history():
    out, _ = day(overload=[(60, 120)])          # 10:00~11:00 과부하 → 10:19 에 20/30 도달하지만 09:30 아침 + 1시간 텀 → 10:30
    assert ("10:30", "spike") in out
    assert ("11:30", "random") in out           # 10:30 + 60분 = 11:30 → 보충 뜸

def test_one_hour_gap_skips_fixed_slot():
    out, _ = day(overload=[(120, 180)])         # 11:00~12:00 과부하 → 11:19 spike → 11:30 고정 스킵 (뒤로 밀리지 않음)
    assert ("11:19", "spike") in out and not any(p == "random" and t < "14:00" for t, p in out)

def test_daily_max_eight():
    out, _ = day(overload=[(0, 570)])
    assert len(out) <= policy.DAILY_MAX and all(p in ("spike", "morning") for _, p in out)

def test_no_prompt_after_1830_or_idle():
    st = PromptState(); t = datetime(2026, 10, 7, 18, 31, tzinfo=KST)
    assert decide(st, 70, 1, False, t, 63) == "none"
    assert decide(PromptState(), 70, 0, False, datetime(2026, 10, 7, 10, 0, tzinfo=KST), 63) == "none"

def test_midnight_reset():
    st = PromptState()
    for i in range(70): decide(st, 40, 1, False, datetime(2026, 10, 7, 23, 0, tzinfo=KST) + timedelta(minutes=i), 63)
    assert st.cur_date.day == 8 and st.day_count == 0 and st.did_morning is False   # 자정 넘김 → 리셋, 00:30 아침은 활동 30분 뒤라 아직
