-- White Sand Boutique Hotel Da Nang: declared max price ceiling,
-- persistent coupon ledger, and quote pricing context snapshot columns.

ALTER TABLE room_types
  ADD COLUMN IF NOT EXISTS declared_max_price NUMERIC(10, 2);

ALTER TABLE room_types
  DROP CONSTRAINT IF EXISTS room_types_declared_max_price_check;
ALTER TABLE room_types
  ADD CONSTRAINT room_types_declared_max_price_check
  CHECK (declared_max_price IS NULL OR declared_max_price >= base_price);

-- Backfill public declared max rates only for matching White Sand room types.
UPDATE room_types SET declared_max_price = 1550000
WHERE type_id = 1 AND LOWER(name) = LOWER('Superior Room') AND base_price <= 1550000 AND declared_max_price IS NULL;

UPDATE room_types SET declared_max_price = 1700000
WHERE type_id = 2 AND LOWER(name) = LOWER('Deluxe Room') AND base_price <= 1700000 AND declared_max_price IS NULL;

UPDATE room_types SET declared_max_price = 1850000
WHERE type_id = 3 AND LOWER(name) = LOWER('Premium Room') AND base_price <= 1850000 AND declared_max_price IS NULL;

UPDATE room_types SET declared_max_price = 2000000
WHERE type_id = 4 AND LOWER(name) = LOWER('Executive Room') AND base_price <= 2000000 AND declared_max_price IS NULL;

UPDATE room_types SET declared_max_price = 2150000
WHERE type_id = 5 AND LOWER(name) = LOWER('Suite') AND base_price <= 2150000 AND declared_max_price IS NULL;

UPDATE room_types SET declared_max_price = 2300000
WHERE type_id = 6 AND LOWER(name) = LOWER('Studio Apartment') AND base_price <= 2300000 AND declared_max_price IS NULL;

CREATE TABLE IF NOT EXISTS pricing_coupons (
  code VARCHAR(32) PRIMARY KEY,
  description_vi VARCHAR(255) NOT NULL,
  discount_pct NUMERIC(5, 4) NOT NULL,
  max_discount_vnd NUMERIC(12, 2) NOT NULL,
  min_room_type_id INT NOT NULL DEFAULT 1,
  usage_limit INT NOT NULL,
  used_count INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pricing_coupons_code_check CHECK (code = UPPER(BTRIM(code)) AND code ~ '^[A-Z0-9_-]{3,32}$'),
  CONSTRAINT pricing_coupons_discount_pct_check CHECK (discount_pct > 0 AND discount_pct <= 0.50),
  CONSTRAINT pricing_coupons_max_discount_check CHECK (max_discount_vnd > 0),
  CONSTRAINT pricing_coupons_min_room_type_check CHECK (min_room_type_id >= 1),
  CONSTRAINT pricing_coupons_usage_limit_check CHECK (usage_limit >= 1),
  CONSTRAINT pricing_coupons_used_count_check CHECK (used_count >= 0 AND used_count <= usage_limit)
);

INSERT INTO pricing_coupons (
  code, description_vi, discount_pct, max_discount_vnd,
  min_room_type_id, usage_limit, used_count, active, expiry_date
) VALUES
  (
    'WHITESAND10',
    'Ưu đãi đặt trực tiếp White Sand Boutique Hotel - giảm 10% (tối đa 300.000 VND/đêm)',
    0.1000, 300000, 1, 200, 0, TRUE, '2027-12-31'
  ),
  (
    'SUMMER15',
    'Ưu đãi mùa biển Mỹ Khê - giảm 15% (tối đa 450.000 VND/đêm)',
    0.1500, 450000, 1, 150, 0, TRUE, '2027-12-31'
  ),
  (
    'SUITE20',
    'Ưu đãi hạng cao cấp (Suite & Studio Apartment) - giảm 20% (tối đa 600.000 VND/đêm)',
    0.2000, 600000, 5, 100, 0, TRUE, '2027-12-31'
  ),
  (
    'DIFF2026',
    'Ưu đãi mùa Lễ hội Pháo hoa Quốc tế Đà Nẵng DIFF - giảm 12% (tối đa 400.000 VND/đêm)',
    0.1200, 400000, 1, 120, 0, TRUE, '2027-12-31'
  ),
  (
    'EXPIRED50',
    'Mã giảm giá 50% đã hết hạn dùng để kiểm thử quy tắc từ chối coupon',
    0.5000, 1000000, 1, 50, 0, FALSE, '2025-12-31'
  )
ON CONFLICT (code) DO NOTHING;

ALTER TABLE pricing_quotes
  ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS coupon_discount_vnd NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pre_coupon_total_price NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS is_floor_price_clamped BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pricing_breakdown JSONB;

ALTER TABLE pricing_quotes
  DROP CONSTRAINT IF EXISTS pricing_quotes_coupon_discount_check;
ALTER TABLE pricing_quotes
  ADD CONSTRAINT pricing_quotes_coupon_discount_check CHECK (coupon_discount_vnd >= 0);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotelai_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON pricing_coupons TO hotelai_runtime;
  END IF;
END $$;

