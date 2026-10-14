import hashlib
import secrets

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db

bearer = HTTPBearer(auto_error=False)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_token() -> str:
    return secrets.token_urlsafe(48)


def require_raw_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> str:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Bearer token required")

    token_hash = hash_token(credentials.credentials)

    if not db.available():
        raise HTTPException(status_code=503, detail="Database unavailable")

    with db.conn() as conn:
        row = conn.execute(
            "SELECT user_id FROM users WHERE token_hash = %s",
            (token_hash,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    return str(row[0])
