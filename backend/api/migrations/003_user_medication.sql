-- 003 복약 / 건기식 — 정화 설계 (10/6). 001 에서 분리: 이미 001 이 적용된 DB(로컬·RDS)에도 적용되게.
--
-- med_product / hff_product 는 정화 데이터 파이프라인(Alembic)이 운영 RDS 에 만들어 적재하는 Catalog 테이블.
-- 여기서는 (1) 구 설계(001 초기판)의 uuid 형 med_product / medications 가 남아 있으면 지우고 (운영 RDS 의 bigint 형은 건드리지 않음)
--          (2) Catalog 3 테이블을 RDS 와 동일 구조로 IF NOT EXISTS 생성 (정화 docs/db/carepong_product_schema.sql 기준)
--          (3) catalog 검색(word_similarity)용 pg_trgm 확장
--          (4) user_medication 생성.  운영 RDS 에서는 (1)(2) 가 건너뛰어지고 (3)(4) 만 적용된다.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'med_product' AND column_name = 'med_product_id' AND data_type = 'uuid') THEN
    DROP TABLE IF EXISTS medications;
    DROP TABLE IF EXISTS med_product;
  END IF;
END $$;

-- ── Catalog 테이블 (정화 docs/db/carepong_product_schema.sql = 운영 RDS pg_dump --schema-only 를 IF NOT EXISTS 로 옮김) ──
-- 운영 RDS 에는 이미 존재 → 전부 건너뜀. 로컬·신규 DB 에서는 RDS 와 동일한 구조로 생성(데이터는 비어 있음).
CREATE TABLE IF NOT EXISTS med_product (
  med_product_id    bigserial PRIMARY KEY,
  item_seq          varchar(30)  NOT NULL UNIQUE,
  product_name      varchar(300) NOT NULL,
  manufacturer_name varchar(300),
  etc_otc_code      varchar(50),
  dosage_form       varchar(100),
  route             varchar(100),
  permit_date       date,
  permit_status     varchar(30),
  source_updated_at timestamp,
  synced_at         timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_med_product_product_name ON med_product(product_name);

CREATE TABLE IF NOT EXISTS med_patient_info (
  med_product_id    bigint PRIMARY KEY REFERENCES med_product(med_product_id) ON DELETE CASCADE,
  efficacy_text     text,
  usage_text        text,
  warning_text      text,
  interaction_text  text,
  side_effect_text  text,
  storage_text      text,
  source_updated_at timestamp
);

CREATE TABLE IF NOT EXISTS hff_product (
  hff_product_id    bigserial PRIMARY KEY,
  prdlst_report_no  varchar(50)  NOT NULL UNIQUE,
  product_name      varchar(300) NOT NULL,
  manufacturer_name varchar(300),
  function_text     text,
  intake_method     text,
  caution_text      text,
  raw_material_text text,
  source_updated_at timestamp,
  synced_at         timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_hff_product_product_name ON hff_product(product_name);

-- catalog 검색(word_similarity) 용
CREATE EXTENSION IF NOT EXISTS pg_trgm;

--
-- [중요]
-- med_product / hff_product / med_patient_info 는 기존 데이터 파이프라인(Alembic)이
-- 생성·적재하는 Catalog/Data 영역 테이블이다.
-- 현재 운영 RDS에도 이미 존재하며 실제 데이터가 적재되어 있으므로
-- backend-service 의 SQL migration 에서는 재정의/재생성하지 않는다.
--
-- 현재 운영 RDS 기준:
--   med_product.med_product_id : BIGINT
--   hff_product.hff_product_id : BIGINT
--
-- user_medication 은 최신 설계의 사용자 복용 등록 테이블을 따른다.
-- 단, 논리 설계서의 user_id BIGINT는 현재 운영 서버 users.user_id(UUID)와 연결해야 하므로
-- 물리 구현에서만 UUID로 맞춘다. 제품/복약 논리 구조는 최신 설계를 유지한다.

CREATE TABLE IF NOT EXISTS user_medication (
  user_medication_id bigserial PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(user_id),

  item_type          varchar(20) NOT NULL,
  med_product_id     bigint REFERENCES med_product(med_product_id),
  hff_product_id     bigint REFERENCES hff_product(hff_product_id),

  start_date         date,
  end_date           date,
  dose_text          varchar(300),
  schedule_json      jsonb,
  active             boolean NOT NULL DEFAULT true,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_user_medication_item_type
    CHECK (item_type IN ('DRUG', 'HFF')),

  CONSTRAINT ck_user_medication_product_ref
    CHECK (
      (item_type = 'DRUG' AND med_product_id IS NOT NULL AND hff_product_id IS NULL)
      OR
      (item_type = 'HFF' AND hff_product_id IS NOT NULL AND med_product_id IS NULL)
    ),

  CONSTRAINT ck_user_medication_date_range
    CHECK (
      end_date IS NULL
      OR start_date IS NULL
      OR end_date >= start_date
    )
);

CREATE INDEX IF NOT EXISTS ix_user_medication_user
  ON user_medication(user_id);

CREATE INDEX IF NOT EXISTS ix_user_medication_user_active
  ON user_medication(user_id, active);

CREATE INDEX IF NOT EXISTS ix_user_medication_med_product
  ON user_medication(med_product_id)
  WHERE med_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_user_medication_hff_product
  ON user_medication(hff_product_id)
  WHERE hff_product_id IS NOT NULL;

