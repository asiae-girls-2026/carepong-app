import zlib

import base64
import gzip
import hashlib
import json
from datetime import timedelta
from zoneinfo import ZoneInfo
from fastapi import Request

import os
import re
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services.raw_auth import require_raw_user

router = APIRouter(tags=["Raw 데이터"])

BUCKET = os.getenv("RAW_S3_BUCKET", "carepong-raw-2026")
REGION = os.getenv("AWS_REGION", "ap-northeast-2")

s3 = boto3.client("s3", region_name=REGION)

BATCH_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,180}$")


class RawUploadIn(BaseModel):
    batch_id: str = Field(..., min_length=1, max_length=180)
    stream: str
    schema: str
    session: str
    count: int = Field(..., ge=1)
    bytes: int = Field(..., ge=1, le=20 * 1024 * 1024)
    sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    content_encoding: str
    ts_first: str | None = None
    ts_last: str | None = None
    collector_version: str | None = None


# 기존 호환 API: S3 Presigned URL을 발급한다.
@router.post("/raw/upload-url")
def create_upload_url(
    body: RawUploadIn,
    user_id: str = Depends(require_raw_user),
):
    if body.stream not in ("ev", "wd"):
        raise HTTPException(422, "Invalid stream")

    if body.content_encoding != "gzip":
        raise HTTPException(422, "Only gzip is supported")

    if not BATCH_PATTERN.fullmatch(body.batch_id):
        raise HTTPException(422, "Invalid batch_id")

    # Collector 파일명은 session__stream__... 형태
    if not body.batch_id.startswith(body.session + "__" + body.stream + "__"):
        raise HTTPException(422, "Batch metadata mismatch")

    try:
        if body.ts_first:
            date = datetime.fromisoformat(
                body.ts_first.replace("Z", "+00:00")
            ).date().isoformat()
        else:
            date = datetime.now(timezone.utc).date().isoformat()
    except ValueError:
        raise HTTPException(422, "Invalid timestamp")

    key = (
        f"raw/{body.stream}/dt={date}/"
        f"{user_id}/{body.batch_id}.ndjson.gz"
    )

    try:
        # 실제 S3 객체가 존재하는 경우에만 중복 처리
        try:
            existing = s3.head_object(Bucket=BUCKET, Key=key)
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                existing = None
            else:
                raise

        if existing is not None:
            if existing.get("ContentLength") != body.bytes:
                raise HTTPException(409, "Existing object size mismatch")

            return {
                "already_exists": True,
                "upload_url": None,
                "headers": {},
            }

        headers = {
            "Content-Type": "application/gzip",
        }

        url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": BUCKET,
                "Key": key,
                "ContentType": "application/gzip",
            },
            ExpiresIn=300,
            HttpMethod="PUT",
        )

        return {
            "already_exists": False,
            "upload_url": url,
            "headers": headers,
        }

    except HTTPException:
        raise
    except ClientError:
        raise HTTPException(503, "S3 operation failed")



# 신규 Raw API: gzip 배치를 Backend가 직접 받아 S3 저장 후 ACK를 반환한다.
@router.post("/raw/batches")
async def receive_raw_batch(
    request: Request,
    user_id: str = Depends(require_raw_user),
):
    """gzip Raw 배치를 검증하고 S3에 영구 저장한 뒤 ACK를 반환한다."""
    encoded = request.headers.get("X-Raw-Batch-Meta")
    if not encoded:
        raise HTTPException(422, "X-Raw-Batch-Meta required")

    try:
        padded = encoded + "=" * (-len(encoded) % 4)
        meta = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, TypeError, UnicodeDecodeError):
        raise HTTPException(422, "Invalid batch metadata")

    if not isinstance(meta, dict):
        raise HTTPException(422, "Invalid metadata object")

    batch_id = meta.get("batch_id")
    stream = meta.get("stream")
    sha256 = meta.get("sha256")
    event_date = meta.get("event_date_kst")

    for field in ("schema", "session"):
        if not isinstance(meta.get(field), str) or not meta[field].strip():
            raise HTTPException(422, f"Missing or invalid {field}")

    expected_schema = {"ev": "km-ev-v1", "wd": "km-raw-v1"}
    if meta.get("stream") not in expected_schema:
        raise HTTPException(422, "Invalid stream")
    if meta["schema"] != expected_schema[meta["stream"]]:
        raise HTTPException(422, "Invalid schema")

    if "ts_first" not in meta or "ts_last" not in meta:
        raise HTTPException(422, "Missing batch timestamps")

    if not isinstance(meta.get("count"), int) or isinstance(meta["count"], bool) or meta["count"] < 1:
        raise HTTPException(422, "Invalid count")

    if not isinstance(meta.get("bytes"), int) or isinstance(meta["bytes"], bool) or meta["bytes"] < 1:
        raise HTTPException(422, "Invalid bytes")

    if not isinstance(batch_id, str) or not BATCH_PATTERN.fullmatch(batch_id):
        raise HTTPException(422, "Invalid batch_id")

    if stream not in ("ev", "wd"):
        raise HTTPException(422, "Invalid stream")

    if not isinstance(sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise HTTPException(422, "Invalid SHA256")

    if not isinstance(event_date, str):
        raise HTTPException(422, "event_date_kst required")

    try:
        date_obj = datetime.strptime(event_date, "%Y-%m-%d").date()
        def parse_batch_ts(value):
            if stream == "ev":
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ValueError("ev timestamp must be epoch seconds")
                from math import isfinite
                if not isfinite(value):
                    raise ValueError("Non-finite timestamp")
                return datetime.fromtimestamp(value, tz=ZoneInfo("UTC"))

            if not isinstance(value, str):
                raise ValueError("wd timestamp must be ISO 8601")
            return datetime.fromisoformat(value.replace("Z", "+00:00"))

        first = parse_batch_ts(meta["ts_first"])
        last = parse_batch_ts(meta["ts_last"])

        if first.tzinfo is None or last.tzinfo is None:
            raise ValueError("Timezone required")

        if first > last:
            raise ValueError("Invalid timestamp order")

        kst = ZoneInfo("Asia/Seoul")
        if first.astimezone(kst).date() != date_obj:
            raise ValueError("First timestamp date mismatch")
        if last.astimezone(kst).date() != date_obj:
            raise ValueError("Last timestamp date mismatch")
    except (ValueError, TypeError, OverflowError):
        raise HTTPException(422, "Invalid batch timestamps or KST date")

    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/gzip":
        raise HTTPException(415, "Content-Type must be application/gzip")

    limit = 200 * 1024 * 1024
    data = bytearray()

    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > limit:
            raise HTTPException(413, "Batch exceeds 200 MiB")

    if not data:
        raise HTTPException(422, "Empty batch")

    body = bytes(data)
    actual_sha = hashlib.sha256(body).hexdigest()

    if actual_sha != sha256:
        raise HTTPException(422, "SHA256 mismatch")

    if "bytes" in meta and meta["bytes"] != len(body):
        raise HTTPException(422, "Byte count mismatch")

    # gzip 압축 해제 중에도 출력 크기를 제한한다.
    max_decoded = 500 * 1024 * 1024

    try:
        decoder = zlib.decompressobj(wbits=16 + zlib.MAX_WBITS)
        decoded = decoder.decompress(body, max_decoded + 1)

        if len(decoded) > max_decoded:
            raise HTTPException(413, "Decompressed batch too large")

        if not decoder.eof or decoder.unused_data:
            raise HTTPException(422, "Incomplete or trailing gzip data")

        decoded += decoder.flush()

        if len(decoded) > max_decoded:
            raise HTTPException(413, "Decompressed batch too large")

    except zlib.error:
        raise HTTPException(422, "Invalid gzip")

    # Collector v0.2.4 Raw 계약 검증
    event_kinds = {
        "k_char", "k_special", "k_dir", "k_err", "k_space",
        "k_shortcut", "m_left", "m_right", "m_scroll", "m_move",
    }

    try:
        lines = decoded.splitlines()
        if not lines:
            raise ValueError("Empty NDJSON")

        first_ts = None
        last_ts = None

        for line in lines:
            if not line.strip():
                raise ValueError("Empty NDJSON line")

            record = json.loads(line)

            if not isinstance(record, dict):
                raise ValueError("Record must be an object")

            if stream == "ev":
                ts = record.get("ts")
                if isinstance(ts, bool) or not isinstance(ts, (int, float)):
                    raise ValueError("Invalid ev timestamp")

                value = record.get("value")
                if value is not None and (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                ):
                    raise ValueError("Invalid event value")

                if record.get("session") != meta["session"]:
                    raise ValueError("Session mismatch")

                if record.get("kind") not in event_kinds:
                    raise ValueError("Invalid event kind")

                if record["kind"] == "m_move" and (
                    value is None or value < 0
                ):
                    raise ValueError("Invalid mouse movement")

            else:
                ts = record.get("ts")
                window_start = record.get("window_start")
                window_sec = record.get("window_sec")

                if record.get("schema") != "km-raw-v1":
                    raise ValueError("Invalid wd schema")

                if not isinstance(window_start, str):
                    raise ValueError("Invalid window_start")

                start_dt = parse_batch_ts(window_start)
                end_dt = parse_batch_ts(ts)

                if start_dt.tzinfo is None or end_dt.tzinfo is None:
                    raise ValueError("Timezone required")

                if start_dt > end_dt:
                    raise ValueError("Invalid window interval")

                if (
                    isinstance(window_sec, bool)
                    or not isinstance(window_sec, (int, float))
                    or window_sec <= 0
                ):
                    raise ValueError("Invalid window_sec")

                if not isinstance(record.get("keyboard"), dict):
                    raise ValueError("Invalid keyboard data")

                if not isinstance(record.get("mouse"), dict):
                    raise ValueError("Invalid mouse data")

            parsed_ts = parse_batch_ts(ts)

            if parsed_ts.tzinfo is None:
                raise ValueError("Timezone required")

            if parsed_ts.astimezone(kst).date() != date_obj:
                raise ValueError("Record date mismatch")

            if first_ts is None:
                first_ts = parsed_ts
            last_ts = parsed_ts

        if len(lines) != meta["count"]:
            raise ValueError("Record count mismatch")

        if first_ts != first or last_ts != last:
            raise ValueError("Batch timestamp mismatch")

    except (
        ValueError, TypeError, UnicodeDecodeError,
        OverflowError, KeyError,
    ) as exc:
        raise HTTPException(422, f"Invalid Raw NDJSON: {exc}")

    key = (
        f"raw/raw-events/dt={event_date}/stream={stream}/"
        f"user_id={user_id}/{batch_id}.ndjson.gz"
    )

    try:
        try:
            existing = s3.head_object(Bucket=BUCKET, Key=key)
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                existing = None
            else:
                raise

        if existing is not None:
            previous_sha = existing.get("Metadata", {}).get("sha256")
            if previous_sha != sha256:
                raise HTTPException(409, "Batch ID conflict")

            return {
                "stored": False,
                "already_exists": True,
                "batch_id": batch_id,
                "sha256": sha256,
            }

        s3.put_object(
            Bucket=BUCKET,
            Key=key,
            Body=body,
            ContentType="application/gzip",
            Metadata={
                "sha256": sha256,
                "batch-id": batch_id,
                "stream": stream,
            },
            IfNoneMatch="*",
        )

        return {
            "stored": True,
            "already_exists": False,
            "batch_id": batch_id,
            "sha256": sha256,
        }

    except HTTPException:
        raise
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("PreconditionFailed", "ConditionalRequestConflict"):
            try:
                existing = s3.head_object(Bucket=BUCKET, Key=key)
                if existing.get("Metadata", {}).get("sha256") == sha256:
                    return {
                        "stored": False,
                        "already_exists": True,
                        "batch_id": batch_id,
                        "sha256": sha256,
                    }
            except ClientError:
                pass
            raise HTTPException(409, "Concurrent batch upload conflict")
        raise HTTPException(503, "S3 storage unavailable")
