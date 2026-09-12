-- Kích hoạt extension để sử dụng kiểu dữ liệu UUID tự động sinh (rất quan trọng cho bảo mật và phân tán dữ liệu)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Bảng Khách hàng
CREATE TABLE customers (
    customer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(20),
    nationality VARCHAR(50),
    password_hash VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'customer',
    account_status VARCHAR(20) NOT NULL DEFAULT 'Active',
    version INT NOT NULL DEFAULT 1,
    auth_version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    CONSTRAINT customers_role_check CHECK (role IN ('customer', 'admin')),
    CONSTRAINT customers_account_status_check
      CHECK (account_status IN ('Active', 'Suspended', 'Deactivated')),
    CONSTRAINT customers_version_check CHECK (version >= 1),
    CONSTRAINT customers_auth_version_check CHECK (auth_version >= 1)
);

CREATE TABLE customer_account_audits (
    audit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL,
    action VARCHAR(30) NOT NULL,
    old_role VARCHAR(20),
    new_role VARCHAR(20),
    old_status VARCHAR(20),
    new_status VARCHAR(20),
    old_version INT NOT NULL,
    new_version INT NOT NULL,
    changed_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    changed_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT customer_account_audits_customer_fk
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT,
    CONSTRAINT customer_account_audits_changed_by_fk
      FOREIGN KEY (changed_by) REFERENCES customers(customer_id) ON DELETE RESTRICT,
    CONSTRAINT customer_account_audits_action_check
      CHECK (action IN ('profile_updated', 'password_changed', 'account_updated', 'deactivated')),
    CONSTRAINT customer_account_audits_version_check CHECK (new_version > old_version)
);

CREATE INDEX idx_customers_role_status_created_at
  ON customers (role, account_status, created_at DESC, customer_id DESC);
CREATE INDEX idx_customer_account_audits_customer_created_at
  ON customer_account_audits (customer_id, created_at DESC, audit_id DESC);

-- 2. Bảng Loại phòng
CREATE TABLE room_types (
    type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    base_price NUMERIC(10, 2) NOT NULL CHECK (base_price > 0),
    capacity INT NOT NULL CHECK (capacity > 0)
);

-- 3. Bảng Phòng vật lý
CREATE TABLE rooms (
    room_id SERIAL PRIMARY KEY,
    type_id INT NOT NULL,
    room_number VARCHAR(10) UNIQUE NOT NULL,
    current_status VARCHAR(20) NOT NULL DEFAULT 'Available'
        CHECK (current_status IN ('Available', 'Occupied', 'Maintenance')),
    housekeeping_status VARCHAR(20) NOT NULL DEFAULT 'Ready'
        CHECK (housekeeping_status IN ('Ready', 'Dirty', 'Cleaning')),
    housekeeping_version INT NOT NULL DEFAULT 1
        CHECK (housekeeping_version >= 1),
    housekeeping_updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    occupancy_booking_id UUID,
    CONSTRAINT rooms_type_fk FOREIGN KEY (type_id) REFERENCES room_types(type_id) ON DELETE RESTRICT
);

-- 4. Bảng Đơn đặt phòng (Booking)
CREATE TABLE bookings (
    booking_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Dùng để tính Lead Time cho AI
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    guest_count INT NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'Confirmed',
    checked_in_at TIMESTAMPTZ,
    checked_in_by UUID,
    checked_out_at TIMESTAMPTZ,
    checked_out_by UUID,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT,
    CONSTRAINT bookings_checked_in_by_fk
      FOREIGN KEY (checked_in_by) REFERENCES customers(customer_id) ON DELETE RESTRICT,
    CONSTRAINT bookings_checked_out_by_fk
      FOREIGN KEY (checked_out_by) REFERENCES customers(customer_id) ON DELETE RESTRICT,
    CONSTRAINT bookings_status_check
      CHECK (status IN ('Confirmed', 'CheckedIn', 'Canceled', 'Completed')),
    CONSTRAINT bookings_guest_count_check CHECK (guest_count > 0),
    CONSTRAINT bookings_stay_audit_check CHECK (
      (status <> 'CheckedIn' OR (checked_in_at IS NOT NULL AND checked_in_by IS NOT NULL))
      AND (checked_out_at IS NULL OR checked_in_at IS NOT NULL)
      AND ((checked_out_at IS NULL AND checked_out_by IS NULL)
        OR (checked_out_at IS NOT NULL AND checked_out_by IS NOT NULL))
    ),
    CONSTRAINT chk_dates CHECK (check_out_date > check_in_date) -- Ràng buộc logic ngày tháng
);

-- Một key được giới hạn theo tài khoản khách. Payload hash ngăn việc vô tình
-- tái sử dụng cùng key cho một yêu cầu đặt phòng khác.
CREATE TABLE booking_create_requests (
    customer_id UUID NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    booking_id UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_id, idempotency_key),
    CONSTRAINT booking_create_requests_customer_fk
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
    CONSTRAINT booking_create_requests_booking_fk
      FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    CONSTRAINT booking_create_requests_key_check
      CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
    CONSTRAINT booking_create_requests_hash_check
      CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

-- Liên kết trạng thái phòng với đúng booking đang lưu trú. Chiều ngược lại
-- vẫn cho phép Occupied không có booking để tương thích dữ liệu vận hành cũ,
-- nhưng API quản trị không tạo trạng thái legacy này nữa.
ALTER TABLE rooms
  ADD CONSTRAINT rooms_occupancy_booking_fk
  FOREIGN KEY (occupancy_booking_id) REFERENCES bookings(booking_id) ON DELETE RESTRICT;
ALTER TABLE rooms
  ADD CONSTRAINT rooms_occupancy_state_check
  CHECK (occupancy_booking_id IS NULL OR current_status = 'Occupied');
ALTER TABLE rooms
  ADD CONSTRAINT rooms_occupied_housekeeping_ready_check
  CHECK (current_status <> 'Occupied' OR housekeeping_status = 'Ready');
CREATE UNIQUE INDEX uq_rooms_occupancy_booking_id
  ON rooms (occupancy_booking_id)
  WHERE occupancy_booking_id IS NOT NULL;

-- 5. Bảng Chi tiết Đơn đặt phòng
CREATE TABLE booking_details (
    detail_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL,
    room_id INT NOT NULL,
    applied_price NUMERIC(10, 2) NOT NULL CHECK (applied_price >= 0),
    room_number_snapshot VARCHAR(10) NOT NULL,
    room_type_name_snapshot VARCHAR(50) NOT NULL,
    room_assignment_version INT NOT NULL DEFAULT 1
        CHECK (room_assignment_version >= 1),
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE RESTRICT
);

-- 5b. Sổ cái thanh toán thủ công. Mỗi dòng là bất biến; hoàn tiền là
-- một giao dịch mới tham chiếu giao dịch thu ban đầu.
CREATE TABLE payment_transactions (
    payment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL,
    transaction_type VARCHAR(20) NOT NULL,
    parent_payment_id UUID,
    amount NUMERIC(12, 2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'VND',
    method VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Succeeded',
    idempotency_key VARCHAR(100) NOT NULL UNIQUE,
    external_reference VARCHAR(100),
    note VARCHAR(250),
    created_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT payment_transactions_booking_fk
      FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE RESTRICT,
    CONSTRAINT payment_transactions_parent_fk
      FOREIGN KEY (parent_payment_id) REFERENCES payment_transactions(payment_id) ON DELETE RESTRICT,
    CONSTRAINT payment_transactions_created_by_fk
      FOREIGN KEY (created_by) REFERENCES customers(customer_id) ON DELETE RESTRICT,
    CONSTRAINT payment_transactions_type_check
      CHECK (transaction_type IN ('Payment', 'Refund')),
    CONSTRAINT payment_transactions_parent_check
      CHECK ((transaction_type = 'Payment' AND parent_payment_id IS NULL)
          OR (transaction_type = 'Refund' AND parent_payment_id IS NOT NULL)),
    CONSTRAINT payment_transactions_amount_check CHECK (amount > 0),
    CONSTRAINT payment_transactions_currency_check CHECK (currency = 'VND'),
    CONSTRAINT payment_transactions_method_check
      CHECK (method IN ('Cash', 'BankTransfer', 'CardTerminal')),
    CONSTRAINT payment_transactions_status_check CHECK (status = 'Succeeded')
);

CREATE INDEX idx_payment_transactions_booking_created_at
  ON payment_transactions (booking_id, created_at DESC, payment_id DESC);
CREATE INDEX idx_payment_transactions_parent
  ON payment_transactions (parent_payment_id)
  WHERE parent_payment_id IS NOT NULL;

-- 5c. Transactional outbox. Domain mutations append an event in the same
-- transaction; a background publisher delivers it to Kafka at least once.
CREATE TABLE event_outbox (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error VARCHAR(500),
    CONSTRAINT event_outbox_aggregate_type_check CHECK (aggregate_type <> ''),
    CONSTRAINT event_outbox_aggregate_id_check CHECK (aggregate_id <> ''),
    CONSTRAINT event_outbox_event_type_check CHECK (event_type <> ''),
    CONSTRAINT event_outbox_payload_object_check CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT event_outbox_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX idx_event_outbox_pending
  ON event_outbox (next_attempt_at ASC, occurred_at ASC, event_id ASC)
  WHERE published_at IS NULL;
CREATE INDEX idx_event_outbox_pending_aggregate_order
  ON event_outbox (aggregate_type, aggregate_id, occurred_at ASC, event_id ASC)
  WHERE published_at IS NULL;
CREATE INDEX idx_event_outbox_published_at
  ON event_outbox (published_at DESC)
  WHERE published_at IS NOT NULL;

-- 6. Bảng Nhật ký Giá động (Cầu nối với module AI)
CREATE TABLE daily_pricing_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL,
    type_id INT NOT NULL,
    target_date DATE NOT NULL,
    lead_time INT NOT NULL,
    is_weekend BOOLEAN NOT NULL,
    total_of_special_requests INT NOT NULL,
    ai_multiplier NUMERIC(5, 3) NOT NULL, -- VD: 1.150
    base_price NUMERIC(10, 2) NOT NULL,
    final_price NUMERIC(10, 2) NOT NULL,
    pricing_source VARCHAR(20) NOT NULL DEFAULT 'ai',
    settings_version INT NOT NULL,
    ai_enabled BOOLEAN NOT NULL,
    ai_model_version VARCHAR(100),
    ai_training_run_id VARCHAR(100),
    ai_feature_contract_version VARCHAR(50),
    room_type_name_snapshot VARCHAR(50) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT daily_pricing_logs_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE RESTRICT,
    CONSTRAINT daily_pricing_logs_booking_unique UNIQUE (booking_id),
    CONSTRAINT daily_pricing_logs_type_fk FOREIGN KEY (type_id) REFERENCES room_types(type_id) ON DELETE RESTRICT,
    CONSTRAINT daily_pricing_logs_lead_time_check CHECK (lead_time >= 0),
    CONSTRAINT daily_pricing_logs_special_requests_check CHECK (total_of_special_requests BETWEEN 0 AND 5),
    CONSTRAINT daily_pricing_logs_multiplier_range_check CHECK (ai_multiplier BETWEEN 0.5 AND 3),
    CONSTRAINT positive_final_price CHECK (final_price >= 0),
    CONSTRAINT daily_pricing_logs_pricing_source_check CHECK (pricing_source IN ('ai', 'base')),
    CONSTRAINT daily_pricing_logs_base_price_check CHECK (base_price > 0),
    CONSTRAINT daily_pricing_logs_settings_version_check CHECK (settings_version >= 1),
    CONSTRAINT daily_pricing_logs_ai_lineage_check CHECK (
      pricing_source = 'base'
      OR (
        ai_model_version IS NOT NULL
        AND BTRIM(ai_model_version) <> ''
        AND ai_training_run_id IS NOT NULL
        AND BTRIM(ai_training_run_id) <> ''
        AND ai_feature_contract_version IS NOT NULL
        AND BTRIM(ai_feature_contract_version) <> ''
      )
    )
);

-- 6b. Mỗi báo giá là một observation bất biến cho feedback loop của AI.
-- Giá được bảo đảm đến expires_at; tồn phòng vẫn được kiểm tra lại khi booking.
CREATE TABLE pricing_quotes (
    quote_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID,
    booking_id UUID UNIQUE,
    room_type_id INT NOT NULL,
    room_type_name_snapshot VARCHAR(50) NOT NULL,
    capacity_snapshot INT NOT NULL,
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    guest_count INT NOT NULL DEFAULT 1,
    total_of_special_requests INT NOT NULL,
    lead_time INT NOT NULL,
    is_weekend BOOLEAN NOT NULL,
    rooms_available INT NOT NULL,
    rooms_sellable_snapshot INT,
    rooms_booked_snapshot INT,
    occupancy_ratio_snapshot NUMERIC(7, 6),
    inventory_snapshot_at TIMESTAMPTZ,
    base_price NUMERIC(10, 2) NOT NULL,
    ai_multiplier NUMERIC(5, 3) NOT NULL,
    nightly_price NUMERIC(10, 2) NOT NULL,
    total_price NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'VND',
    pricing_source VARCHAR(20) NOT NULL,
    settings_version INT NOT NULL,
    ai_model_version VARCHAR(100),
    ai_training_run_id VARCHAR(100),
    ai_feature_contract_version VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    CONSTRAINT pricing_quotes_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
    CONSTRAINT pricing_quotes_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE RESTRICT,
    CONSTRAINT pricing_quotes_room_type_fk FOREIGN KEY (room_type_id) REFERENCES room_types(type_id) ON DELETE RESTRICT,
    CONSTRAINT pricing_quotes_dates_check CHECK (check_out_date > check_in_date),
    CONSTRAINT pricing_quotes_guest_count_check CHECK (guest_count > 0),
    CONSTRAINT pricing_quotes_capacity_check CHECK (capacity_snapshot > 0),
    CONSTRAINT pricing_quotes_guest_capacity_check CHECK (guest_count <= capacity_snapshot),
    CONSTRAINT pricing_quotes_special_requests_check CHECK (total_of_special_requests BETWEEN 0 AND 5),
    CONSTRAINT pricing_quotes_lead_time_check CHECK (lead_time >= 0),
    CONSTRAINT pricing_quotes_availability_check CHECK (rooms_available >= 0),
    CONSTRAINT pricing_quotes_inventory_snapshot_check CHECK (
      (
        rooms_sellable_snapshot IS NULL
        AND rooms_booked_snapshot IS NULL
        AND occupancy_ratio_snapshot IS NULL
        AND inventory_snapshot_at IS NULL
      )
      OR (
        rooms_sellable_snapshot IS NOT NULL
        AND rooms_sellable_snapshot >= 0
        AND rooms_booked_snapshot IS NOT NULL
        AND rooms_booked_snapshot BETWEEN 0 AND rooms_sellable_snapshot
        AND occupancy_ratio_snapshot IS NOT NULL
        AND occupancy_ratio_snapshot BETWEEN 0 AND 1
        AND inventory_snapshot_at IS NOT NULL
      )
    ),
    CONSTRAINT pricing_quotes_base_price_check CHECK (base_price > 0),
    CONSTRAINT pricing_quotes_multiplier_check CHECK (ai_multiplier BETWEEN 0.5 AND 3),
    CONSTRAINT pricing_quotes_nightly_price_check CHECK (nightly_price > 0),
    CONSTRAINT pricing_quotes_total_price_check CHECK (total_price > 0),
    CONSTRAINT pricing_quotes_currency_check CHECK (currency = 'VND'),
    CONSTRAINT pricing_quotes_source_check CHECK (pricing_source IN ('ai', 'base')),
    CONSTRAINT pricing_quotes_settings_version_check CHECK (settings_version >= 1),
    CONSTRAINT pricing_quotes_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT pricing_quotes_acceptance_check CHECK (
      (booking_id IS NULL AND accepted_at IS NULL)
      OR (booking_id IS NOT NULL AND accepted_at IS NOT NULL)
    ),
    CONSTRAINT pricing_quotes_ai_lineage_check CHECK (
      pricing_source = 'base'
      OR (
        ai_model_version IS NOT NULL
        AND BTRIM(ai_model_version) <> ''
        AND ai_training_run_id IS NOT NULL
        AND BTRIM(ai_training_run_id) <> ''
        AND ai_feature_contract_version IS NOT NULL
        AND BTRIM(ai_feature_contract_version) <> ''
      )
    )
);

-- 7. Cấu hình định giá động. CHECK giữ bảng này ở đúng một bản ghi.
CREATE TABLE pricing_settings (
    setting_id SMALLINT PRIMARY KEY,
    ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID,
    CONSTRAINT pricing_settings_singleton_check CHECK (setting_id = 1),
    CONSTRAINT pricing_settings_version_check CHECK (version >= 1),
    CONSTRAINT pricing_settings_updated_by_fk
      FOREIGN KEY (updated_by) REFERENCES customers(customer_id) ON DELETE SET NULL
);

INSERT INTO pricing_settings (setting_id, ai_enabled) VALUES (1, TRUE);

CREATE TABLE pricing_setting_audits (
    audit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_id SMALLINT NOT NULL,
    ai_enabled BOOLEAN NOT NULL,
    version INT NOT NULL UNIQUE,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by UUID,
    CONSTRAINT pricing_setting_audits_setting_check CHECK (setting_id = 1),
    CONSTRAINT pricing_setting_audits_version_check CHECK (version >= 1),
    CONSTRAINT pricing_setting_audits_changed_by_fk
      FOREIGN KEY (changed_by) REFERENCES customers(customer_id) ON DELETE RESTRICT
);

INSERT INTO pricing_setting_audits (setting_id, ai_enabled, version)
VALUES (1, TRUE, 1);

CREATE INDEX idx_daily_pricing_logs_updated_at
  ON daily_pricing_logs (updated_at DESC, log_id DESC);
CREATE INDEX idx_daily_pricing_logs_model_version
  ON daily_pricing_logs (ai_model_version, updated_at DESC)
  WHERE pricing_source = 'ai';
CREATE INDEX idx_pricing_quotes_open_expiry
  ON pricing_quotes (expires_at, quote_id)
  WHERE booking_id IS NULL;
CREATE INDEX idx_pricing_quotes_model_created
  ON pricing_quotes (ai_model_version, created_at DESC)
  WHERE pricing_source = 'ai';
CREATE INDEX idx_pricing_quotes_room_dates
  ON pricing_quotes (room_type_id, check_in_date, check_out_date, created_at DESC);
CREATE UNIQUE INDEX uq_rooms_room_number_ci ON rooms (UPPER(room_number));
CREATE UNIQUE INDEX uq_room_types_name_ci ON room_types (LOWER(name));

CREATE INDEX idx_bookings_created_at_booking_id
  ON bookings (created_at DESC, booking_id DESC);
CREATE INDEX idx_bookings_status_created_at_booking_id
  ON bookings (status, created_at DESC, booking_id DESC);
CREATE INDEX idx_bookings_confirmed_checkout_date
  ON bookings (check_out_date, booking_id)
  WHERE status = 'Confirmed';
CREATE INDEX idx_bookings_active_room_dates
  ON bookings (check_in_date, check_out_date, booking_id)
  WHERE status IN ('Confirmed', 'CheckedIn');
CREATE INDEX idx_bookings_checked_in_checkout_date
  ON bookings (check_out_date, booking_id)
  WHERE status = 'CheckedIn';
