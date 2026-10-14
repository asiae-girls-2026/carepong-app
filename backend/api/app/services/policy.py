"""과부하 확인 팝업(ESM) 정책 v2 — 혜윤 DA API명세서 '3_동작규칙' (10/2) 그대로.
서버 팝업만 담당. 복약·물·휴식 알림, 완화 보상 상한(3회·30분)은 앱 레이어 (결정 B).
상태는 사용자별 메모리(dict) — 재시작하면 당일 카운트 초기화되므로 배포는 08:30 전에. DB 붙이면 user_prompt_state 테이블로.

규칙 (now = 창 시작 시각, KST):
  1. 과부하 판정  : 최근 30창(30분) 중 지수 ≥ cut_intervene 인 창이 20개 이상 → 과부하(spike). 뜨면 이력 0부터.
  2. 우선순위     : 과부하 > 고정 시간. 고정 시간(11:30·14:00·15:30·17:00)은 그 시각에 과부하가 없을 때만 보충.
  3. 1시간 텀     : 직전 팝업(종류 무관)이 '뜬' 시각부터 60분 안엔 어떤 팝업도 안 뜸. 응답 여부 무관.
  4. 하루 횟수    : 아침 1 + 오전 보충 1 + 오후 고정 3 = 최소 5. 과부하로 더 채워져 최대 8. 8 넘으면 그날 중단.
  5. 팝업 유지    : 자동으로 안 닫힘. 응답 상태(answered/dismissed/ignored/pending)는 앱이 self-report 로 보냄.
  6. 초기화       : 자정(KST) 카운트·아침 리셋. 아침 기준선 = 리셋 후 첫 활동(키+마우스>0) 30분 뒤 1회.
  7. 수집 종료    : 18:30 이후 팝업 없음 (방해금지 창).
prompt_type: 'morning' | 'spike' | 'random'(=고정 시간 보충) | 'none'
"""
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

KST = timezone(timedelta(hours=9))

CUT_DEFAULT        = 63
SUSTAIN_WINS       = 30          # 과부하 평가 창(분)
SUSTAIN_NEED       = 20          # 그중 20창 이상
GAP_MIN            = 60          # ★ 절대 1시간 텀 (모든 팝업)
MORNING_AFTER_MIN  = 30          # 첫 활동 30분 뒤 아침 기준선
DAILY_MIN          = 5
DAILY_MAX          = 8
FIXED_SLOTS        = (time(11, 30), time(14, 0), time(15, 30), time(17, 0))   # 과부하 없을 때 보충
COLLECT_END        = time(18, 30)                                              # 방해금지 시작 = 수집 종료
SLOT_GRACE_MIN     = 10          # 고정 시각 ±10분 안에 활동 중이어야 뜸. 1시간 텀에 걸리거나 자리비움이면 스킵 (혜윤: "11:30 고정 스킵")

@dataclass
class PromptState:
    cur_date: date | None = None
    day_count: int = 0
    last_prompt_at: datetime | None = None   # 팝업 '뜬' 시각 (텀 기준)
    first_activity_at: datetime | None = None
    did_morning: bool = False
    ov_hist: list[int] = field(default_factory=list)
    slots_done: set = field(default_factory=set)   # 오늘 처리(발동 또는 스킵)된 고정 슬롯

def to_kst(dt: datetime) -> datetime:
    return dt.replace(tzinfo=KST) if dt.tzinfo is None else dt.astimezone(KST)

def decide(st: PromptState, score: float | None, activity: float, dnd: bool, now: datetime,
           cut_intervene: int = CUT_DEFAULT) -> str:
    """창 1개 처리 후 'morning' | 'spike' | 'random' | 'none'. st 는 제자리 갱신."""
    now = to_kst(now)
    if st.cur_date != now.date():                       # 6. 자정 리셋
        st.cur_date, st.day_count, st.last_prompt_at = now.date(), 0, None
        st.first_activity_at, st.did_morning, st.ov_hist, st.slots_done = None, False, [], set()
    if activity > 0 and st.first_activity_at is None:
        st.first_activity_at = now
    st.ov_hist.append(1 if (score is not None and score >= cut_intervene) else 0)   # 1. 누적(슬라이딩)
    st.ov_hist = st.ov_hist[-SUSTAIN_WINS:]

    # 놓친 고정 슬롯 정리 (grace 넘긴 건 스킵 처리)
    for s in FIXED_SLOTS:
        if s not in st.slots_done and now.time() >= s and (now - now.replace(hour=s.hour, minute=s.minute, second=0, microsecond=0)) > timedelta(minutes=SLOT_GRACE_MIN):
            st.slots_done.add(s)

    if dnd or now.time() >= COLLECT_END or activity == 0 or score is None:   # 7. 수집 종료·자리비움·방해금지
        return "none"
    if st.day_count >= DAILY_MAX:                                              # 4. 상한
        return "none"
    if st.last_prompt_at is not None and (now - st.last_prompt_at) < timedelta(minutes=GAP_MIN):   # 3. 1시간 텀
        return "none"

    ptype = "none"
    if sum(st.ov_hist) >= SUSTAIN_NEED:                                        # 2. 과부하 1순위
        ptype = "spike"; st.ov_hist = []
    elif not st.did_morning and st.first_activity_at and (now - st.first_activity_at) >= timedelta(minutes=MORNING_AFTER_MIN):
        ptype = "morning"; st.did_morning = True
    else:
        due = [s for s in FIXED_SLOTS if s not in st.slots_done and now.time() >= s]
        if due:
            for s in due: st.slots_done.add(s)                                  # 같은 시간대 여러 개면 한 번만
            ptype = "random"
    if ptype != "none":
        st.last_prompt_at = now; st.day_count += 1
    return ptype

# ── 상태 저장소 (메모리). DB 붙이면 이 함수만 교체 ──
MAX_USERS = 1000
_STATES: dict[str, PromptState] = {}

def get_state(user_id: str) -> PromptState:
    if user_id not in _STATES and len(_STATES) >= MAX_USERS:
        _STATES.pop(next(iter(_STATES)))
    return _STATES.setdefault(user_id, PromptState())
