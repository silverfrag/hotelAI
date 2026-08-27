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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT customers_role_check CHECK (role IN ('customer', 'admin'))
);

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
    current_status VARCHAR(20) DEFAULT 'Available' 
        CHECK (current_status IN ('Available', 'Occupied', 'Maintenance')),
    FOREIGN KEY (type_id) REFERENCES room_types(type_id) ON DELETE CASCADE
);

-- 4. Bảng Đơn đặt phòng (Booking)
CREATE TABLE bookings (
    booking_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Dùng để tính Lead Time cho AI
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'Confirmed' 
        CHECK (status IN ('Confirmed', 'Canceled', 'Completed')),
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT,
    CONSTRAINT chk_dates CHECK (check_out_date > check_in_date) -- Ràng buộc logic ngày tháng
);

-- 5. Bảng Chi tiết Đơn đặt phòng
CREATE TABLE booking_details (
    detail_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL,
    room_id INT NOT NULL,
    applied_price NUMERIC(10, 2) NOT NULL CHECK (applied_price >= 0),
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE RESTRICT
);

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
    final_price NUMERIC(10, 2) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT daily_pricing_logs_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    CONSTRAINT daily_pricing_logs_booking_unique UNIQUE (booking_id),
    FOREIGN KEY (type_id) REFERENCES room_types(type_id) ON DELETE CASCADE,
    CONSTRAINT daily_pricing_logs_lead_time_check CHECK (lead_time >= 0),
    CONSTRAINT daily_pricing_logs_special_requests_check CHECK (total_of_special_requests BETWEEN 0 AND 5),
    CONSTRAINT daily_pricing_logs_multiplier_range_check CHECK (ai_multiplier BETWEEN 0.5 AND 3),
    CONSTRAINT positive_final_price CHECK (final_price >= 0)
);
