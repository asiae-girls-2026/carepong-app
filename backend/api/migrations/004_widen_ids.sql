-- 004 ID 칸 확장 (10/7). 앱(carepong-app 0.1.1)이 session_id·window_id 를 UUID(36자)로 보내는데 001 은 varchar(32) 라
-- sessions INSERT 가 "value too long for type character varying(32)" 로 실패 → windows 행이 한 줄도 저장되지 않았다
-- (서버는 저장 실패를 로그만 남기고 200 을 돌려주므로 앱·스모크에서 안 보였음. 스모크는 짧은 ses_/win_ ID 를 써서 통과).
-- 64자로 넓혀 UUID 와 ses_/win_ 둘 다 받는다. 기존 행은 그대로.
ALTER TABLE sessions     ALTER COLUMN session_id TYPE varchar(64);
ALTER TABLE windows      ALTER COLUMN session_id TYPE varchar(64);
ALTER TABLE windows      ALTER COLUMN window_id  TYPE varchar(64);
ALTER TABLE self_reports ALTER COLUMN window_id  TYPE varchar(64);
