"""앱이 켜질 때 받아가는 정책값. 추론·팝업 판단은 서버가 하므로 가중치는 없음 (D03).
팝업 값의 원본 = services/policy (혜윤 DA 명세 10/2), 나머지 = 연우 기획서 10/2."""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from ..services import policy

router = APIRouter(tags=["모델 설정"])

class AppConfig(BaseModel):
    config_version: str = Field("c3")
    model_version: str = Field("v1", description="현재 서버가 쓰는 모델. 표시·로그용")
    window_sec: int = Field(60, description="DA 확정 1분")
    upload_interval_sec: int = Field(60, description="창 업로드 주기 — 활동 0 창도 올림")
    cut_observe: int = Field(50)
    cut_intervene: int = Field(63)
    # 과부하 확인 팝업 (서버 정책 — 혜윤 3_동작규칙)
    daily_prompt_min: int = Field(policy.DAILY_MIN, description="아침 1 + 오전 보충 1 + 오후 고정 3")
    daily_prompt_max: int = Field(policy.DAILY_MAX, description="과부하로 더 채워질 때 상한. 넘으면 그날 중단")
    prompt_gap_min: int = Field(policy.GAP_MIN, description="★ 절대 1시간 텀 — 직전 팝업이 뜬 시각 기준, 종류 무관")
    morning_baseline_min: int = Field(policy.MORNING_AFTER_MIN, description="첫 활동 재개 후 N분 뒤 아침 기준선")
    morning_fill_time: str = Field("11:30", description="오전 보충 — 과부하 없으면 고정")
    afternoon_fixed_times: list[str] = Field(default_factory=lambda: ["14:00", "15:30", "17:00"], description="오후 보충 — 과부하 없을 때")
    prompt_auto_close: bool = Field(False, description="팝업은 자동으로 안 닫힘. 앱이 status 로 응답/닫기/무시/대기 보고")
    snooze_min: int = Field(10, description="'아니오' 후 재팝업 금지 (앱)")
    collect_end: str = Field("18:30", description="수집·팝업 종료 = 방해금지 시작")
    # 완화 보상 (앱 레이어, 결정 B)
    relief_reward_daily_max: int = Field(3, description="심호흡+명상 합산 보상 상한 (앱)")
    relief_reward_cooldown_min: int = Field(30)
    # 방해금지 = 감지 제외 창 (결정 C)
    dnd_default_start: str = Field("18:30")
    dnd_default_end: str = Field("08:30")
    events_upload_at: str = Field("08:30", description="이벤트 묶음 전송 시각 (또는 앱 시작 시)")
    # 알람 간격 기본값 (연우 시트11)
    water_goal_cups: int = 8
    water_interval_min: int = 90
    stretch_interval_min: int = 60
    rest_interval_min: int = 75
    prompt_text: str = Field("지금 스트레스를 받고 계신가요?", description="팝업 문구 (Q07 명명·Q08 문구 결정 전 임시)")
    question_version: str = Field("q1")

@router.get("/config", response_model=AppConfig, summary="[Stub] 앱 시작 시 정책값 다운로드")
def get_config():
    return AppConfig()
