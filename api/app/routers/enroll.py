"""M07 회원번호 등록 및 Bearer 토큰 발급."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ..services import db
from ..services.raw_auth import generate_token, hash_token

router = APIRouter(tags=["회원번호 (M07)"])


class EnrollIn(BaseModel):
    cp_number: str = Field(
        ...,
        min_length=3,
        max_length=12,
        pattern=r"^CP-[A-Z0-9]{1,9}$",
    )
    device_id: str
    app_version: str
    os: str = "windows"


class EnrollOut(BaseModel):
    user_id: str
    access_token: str


@router.post(
    "/enroll",
    response_model=EnrollOut,
    status_code=status.HTTP_201_CREATED,
    summary="회원번호 등록 및 Bearer 토큰 발급",
)
def enroll(body: EnrollIn):
    if not db.available():
        raise HTTPException(
            status_code=503,
            detail="Database unavailable",
        )

    token = generate_token()
    token_hash = hash_token(token)

    with db.conn() as conn:
        row = conn.execute(
            """
            INSERT INTO users (
                cp_number,
                device_id,
                app_version,
                os,
                token_hash
            )
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (cp_number) DO NOTHING
            RETURNING user_id
            """,
            (
                body.cp_number,
                body.device_id,
                body.app_version,
                body.os,
                token_hash,
            ),
        ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=409,
            detail="CP number already enrolled",
        )

    return EnrollOut(
        user_id=str(row[0]),
        access_token=token,
    )
