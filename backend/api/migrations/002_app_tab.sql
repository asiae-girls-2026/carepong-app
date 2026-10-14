-- 채원 검증설계 stress_window.app_category = "그 1분 동안 사용자가 있던 우리 앱 화면" (브라우저·외부 프로그램 아님).
-- 값: pet(오버레이만) / mind / archive / settings / null(앱 미사용). 탭별 이용 빈도·체류시간·지수 상관용.
ALTER TABLE windows ADD COLUMN IF NOT EXISTS app_tab varchar(12);
