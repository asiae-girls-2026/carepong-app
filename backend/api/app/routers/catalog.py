from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from ..services import db


router = APIRouter(tags=["제품 검색"])

ItemType = Literal["DRUG", "HFF"]
MatchType = Literal["EXACT", "CONTAINS", "FUZZY"]

FUZZY_THRESHOLD = 0.6


class CatalogSearchItem(BaseModel):
    item_type: ItemType
    product_id: int
    external_id: str
    product_name: str
    manufacturer_name: str | None = None
    match_type: MatchType
    score: float


class CatalogSearchResponse(BaseModel):
    items: list[CatalogSearchItem]


def _search_drugs(q: str, limit: int) -> list[CatalogSearchItem]:
    if not db.available():
        return []

    contains = f"%{q}%"

    sql = """
    SELECT
        med_product_id,
        item_seq,
        product_name,
        manufacturer_name,
        word_similarity(%s, product_name) AS similarity_score,
        CASE
            WHEN lower(product_name) = lower(%s) THEN 'EXACT'
            WHEN product_name ILIKE %s THEN 'CONTAINS'
            ELSE 'FUZZY'
        END AS match_type
    FROM med_product
    WHERE
        product_name ILIKE %s
        OR word_similarity(%s, product_name) >= %s
    ORDER BY
        CASE
            WHEN lower(product_name) = lower(%s) THEN 1
            WHEN product_name ILIKE %s THEN 2
            ELSE 3
        END,
        similarity_score DESC,
        product_name ASC
    LIMIT %s
    """

    params = (
        q,
        q,
        contains,
        contains,
        q,
        FUZZY_THRESHOLD,
        q,
        contains,
        limit,
    )

    with db.conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    result = []

    for row in rows:
        (
            product_id,
            external_id,
            product_name,
            manufacturer_name,
            similarity_score,
            match_type,
        ) = row

        score = (
            1.0
            if match_type in ("EXACT", "CONTAINS")
            else float(similarity_score or 0)
        )

        result.append(
            CatalogSearchItem(
                item_type="DRUG",
                product_id=product_id,
                external_id=str(external_id),
                product_name=product_name,
                manufacturer_name=manufacturer_name,
                match_type=match_type,
                score=score,
            )
        )

    return result


def _search_hff(q: str, limit: int) -> list[CatalogSearchItem]:
    if not db.available():
        return []

    contains = f"%{q}%"

    sql = """
    SELECT
        hff_product_id,
        prdlst_report_no,
        product_name,
        manufacturer_name,
        word_similarity(%s, product_name) AS similarity_score,
        CASE
            WHEN lower(product_name) = lower(%s) THEN 'EXACT'
            WHEN product_name ILIKE %s THEN 'CONTAINS'
            ELSE 'FUZZY'
        END AS match_type
    FROM hff_product
    WHERE
        product_name ILIKE %s
        OR word_similarity(%s, product_name) >= %s
    ORDER BY
        CASE
            WHEN lower(product_name) = lower(%s) THEN 1
            WHEN product_name ILIKE %s THEN 2
            ELSE 3
        END,
        similarity_score DESC,
        product_name ASC
    LIMIT %s
    """

    params = (
        q,
        q,
        contains,
        contains,
        q,
        FUZZY_THRESHOLD,
        q,
        contains,
        limit,
    )

    with db.conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    result = []

    for row in rows:
        (
            product_id,
            external_id,
            product_name,
            manufacturer_name,
            similarity_score,
            match_type,
        ) = row

        score = (
            1.0
            if match_type in ("EXACT", "CONTAINS")
            else float(similarity_score or 0)
        )

        result.append(
            CatalogSearchItem(
                item_type="HFF",
                product_id=product_id,
                external_id=str(external_id),
                product_name=product_name,
                manufacturer_name=manufacturer_name,
                match_type=match_type,
                score=score,
            )
        )

    return result


@router.get(
    "/catalog/search",
    response_model=CatalogSearchResponse,
    summary="약·건기식 제품 검색",
)
def search_catalog(
    q: str = Query(
        ...,
        min_length=1,
        description="제품명 검색어",
        examples=["타이레놀"],
    ),
    item_type: ItemType | None = Query(
        default=None,
        description="DRUG 또는 HFF. 미지정 시 전체 검색",
    ),
    limit: int = Query(
        default=20,
        ge=1,
        le=50,
        description="최대 검색 결과 수",
    ),
):
    items: list[CatalogSearchItem] = []

    per_type_limit = limit if item_type else limit * 2

    if item_type in (None, "DRUG"):
        items.extend(_search_drugs(q, per_type_limit))

    if item_type in (None, "HFF"):
        items.extend(_search_hff(q, per_type_limit))

    priority = {
        "EXACT": 1,
        "CONTAINS": 2,
        "FUZZY": 3,
    }

    items.sort(
        key=lambda x: (
            priority[x.match_type],
            -x.score,
            x.product_name,
        )
    )

    return CatalogSearchResponse(items=items[:limit])