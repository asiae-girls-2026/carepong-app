"""DB 연결 + 마이그레이션. DATABASE_URL 없거나 연결 실패면 '저장 없이' 동작한다 (로컬 테스트·DB 없는 환경).
앱 시작 시 migrations/*.sql 을 파일명 순으로 적용하고 schema_migrations 에 기록한다.
(10/12) 기동 때 연결에 실패해도 영영 포기하지 않는다 — 요청이 올 때 30초 간격으로 백그라운드 재연결을 시도한다.
  예전엔 EC2 재부팅 직후(네트워크·DNS 미준비)에 1회 실패하면 서버가 살아있는 동안 200 응답만 하고 아무 행도 안 남았음."""
import os, time, logging, pathlib, threading
from contextlib import contextmanager

log = logging.getLogger("carepong.db")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
MIGRATIONS = pathlib.Path(__file__).resolve().parents[2] / "migrations"
_pool = None
_last_try = 0.0          # 마지막 연결 시도 시각 (monotonic)
_retrying = False        # 백그라운드 재연결 스레드 동작 중
RETRY_SEC = 30.0         # 연결 실패 뒤 재시도 간격

def available() -> bool:
    """DB 사용 가능 여부. 연결이 없으면 (30초에 한 번) 백그라운드로 다시 붙어 보고, 이번 요청은 '없음'으로 처리 — 요청 지연 없음."""
    global _retrying
    if _pool is None and DATABASE_URL and not _retrying and time.monotonic() - _last_try >= RETRY_SEC:
        _retrying = True
        threading.Thread(target=_retry, name="db-reconnect", daemon=True).start()
    return _pool is not None

def _retry() -> None:
    global _retrying
    try: init()
    finally: _retrying = False

def init() -> None:
    """main.py lifespan 에서 1회(동기) + available() 이 백그라운드 재시도. 실패해도 앱은 뜬다 (저장만 안 됨).
    마이그레이션까지 끝난 뒤에만 _pool 을 공개한다 (적용 중인 테이블을 요청이 먼저 쓰지 않게)."""
    global _pool, _last_try
    _last_try = time.monotonic()
    if not DATABASE_URL:
        log.warning("DATABASE_URL 없음 — 저장 없이 동작"); return
    pool = None
    try:
        from psycopg_pool import ConnectionPool
        pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=True, timeout=5)
        migrate(pool)
        _pool = pool
        log.info("DB 연결·마이그레이션 완료")
    except Exception as e:
        log.error("DB 연결 실패 — 저장 없이 동작, %ds 뒤 요청 때 재시도: %s", int(RETRY_SEC), e)
        if pool is not None:
            try: pool.close(timeout=1)
            except Exception: pass

def close() -> None:
    global _pool
    if _pool: _pool.close(); _pool = None

@contextmanager
def conn(pool=None):
    with (pool or _pool).connection() as c:
        yield c

def migrate(pool=None) -> None:
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        raise RuntimeError(f"migrations 폴더에 .sql 이 없음: {MIGRATIONS} (Dockerfile 의 COPY migrations 확인)")
    with conn(pool) as c:
        c.execute("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        done = {r[0] for r in c.execute("SELECT filename FROM schema_migrations")}
        for f in files:
            if f.name in done: continue
            c.execute(f.read_text(encoding="utf-8"))
            c.execute("INSERT INTO schema_migrations(filename) VALUES (%s)", (f.name,))
            log.info("migration 적용: %s", f.name)

def ensure_user(cp_number: str, device_id: str = "unknown", app_version: str = "0.0.0") -> str | None:
    """cp_number 로 users 행을 찾거나 만든다. user_id(str) 반환. DB 없으면 None.
    D07 토큰 인증 붙기 전까지 X-User-Id 헤더 값 = cp_number 로 취급."""
    if not available(): return None
    with conn() as c:
        row = c.execute("""INSERT INTO users(cp_number, device_id, app_version) VALUES (%s,%s,%s)
                           ON CONFLICT (cp_number) DO UPDATE SET last_seen_at = now()
                           RETURNING user_id""", (cp_number, device_id, app_version)).fetchone()
        return str(row[0])

def ensure_session(session_id: str, user_id: str, at, app_version: str | None = None) -> None:
    with conn() as c:
        c.execute("""INSERT INTO sessions(session_id, user_id, started_at, ended_at, app_version) VALUES (%s,%s,%s,%s,%s)
                     ON CONFLICT (session_id) DO UPDATE SET ended_at = EXCLUDED.ended_at""",
                  (session_id, user_id, at, at, app_version))
