INSERT INTO customers (customer_id, full_name, email, phone, nationality)
VALUES ('11111111-1111-4111-8111-111111111111', 'Demo Guest', 'guest@example.com', '0900000000', 'VN')
ON CONFLICT (customer_id) DO NOTHING;

-- White Sand Boutique Hotel Đà Nẵng (89-91 Võ Văn Kiệt, Sơn Trà, TP. Đà Nẵng)
-- 6 hạng phòng niêm yết & 54 phòng vật lý trên các tầng 3F - 13F
INSERT INTO room_types (type_id, name, base_price, capacity)
VALUES
  (1, 'Superior Room', 1200000, 2),
  (2, 'Deluxe Room', 1400000, 2),
  (3, 'Premium Room', 1600000, 4),
  (4, 'Executive Room', 1700000, 2),
  (5, 'Suite', 1800000, 3),
  (6, 'Studio Apartment', 2000000, 4)
ON CONFLICT (type_id) DO UPDATE
SET name = EXCLUDED.name, base_price = EXCLUDED.base_price, capacity = EXCLUDED.capacity;

INSERT INTO rooms (type_id, room_number, current_status, housekeeping_status)
VALUES
  -- 1. Superior Room (Type 1): 12 phòng (Tầng 3 - Tầng 4)
  (1, '301', 'Available', 'Ready'),
  (1, '302', 'Available', 'Ready'),
  (1, '303', 'Available', 'Ready'),
  (1, '304', 'Available', 'Ready'),
  (1, '305', 'Available', 'Ready'),
  (1, '306', 'Available', 'Ready'),
  (1, '401', 'Available', 'Ready'),
  (1, '402', 'Available', 'Ready'),
  (1, '403', 'Available', 'Ready'),
  (1, '404', 'Available', 'Ready'),
  (1, '405', 'Available', 'Ready'),
  (1, '406', 'Available', 'Ready'),

  -- 2. Deluxe Room (Type 2): 12 phòng (Tầng 5 - Tầng 6)
  (2, '501', 'Available', 'Ready'),
  (2, '502', 'Available', 'Ready'),
  (2, '503', 'Available', 'Ready'),
  (2, '504', 'Available', 'Ready'),
  (2, '505', 'Available', 'Ready'),
  (2, '506', 'Available', 'Ready'),
  (2, '601', 'Available', 'Ready'),
  (2, '602', 'Available', 'Ready'),
  (2, '603', 'Available', 'Ready'),
  (2, '604', 'Available', 'Ready'),
  (2, '605', 'Available', 'Ready'),
  (2, '606', 'Available', 'Ready'),

  -- 3. Premium Room (Type 3): 8 phòng (Tầng 7 - Tầng 8)
  (3, '701', 'Available', 'Ready'),
  (3, '702', 'Available', 'Ready'),
  (3, '703', 'Available', 'Ready'),
  (3, '704', 'Available', 'Ready'),
  (3, '801', 'Available', 'Ready'),
  (3, '802', 'Available', 'Ready'),
  (3, '803', 'Available', 'Ready'),
  (3, '804', 'Available', 'Ready'),

  -- 4. Executive Room (Type 4): 8 phòng (Tầng 9 - Tầng 10)
  (4, '901', 'Available', 'Ready'),
  (4, '902', 'Available', 'Ready'),
  (4, '903', 'Available', 'Ready'),
  (4, '904', 'Available', 'Ready'),
  (4, '1001', 'Available', 'Ready'),
  (4, '1002', 'Available', 'Ready'),
  (4, '1003', 'Available', 'Ready'),
  (4, '1004', 'Available', 'Ready'),

  -- 5. Suite (Type 5): 8 phòng (Tầng 11 - Tầng 12)
  (5, '1101', 'Available', 'Ready'),
  (5, '1102', 'Available', 'Ready'),
  (5, '1103', 'Available', 'Ready'),
  (5, '1104', 'Available', 'Ready'),
  (5, '1201', 'Available', 'Ready'),
  (5, '1202', 'Available', 'Ready'),
  (5, '1203', 'Available', 'Ready'),
  (5, '1204', 'Available', 'Ready'),

  -- 6. Studio Apartment (Type 6): 6 phòng (Tầng 13)
  (6, '1301', 'Available', 'Ready'),
  (6, '1302', 'Available', 'Ready'),
  (6, '1303', 'Available', 'Ready'),
  (6, '1304', 'Available', 'Ready'),
  (6, '1305', 'Available', 'Ready'),
  (6, '1306', 'Available', 'Ready')
ON CONFLICT (room_number) DO UPDATE
SET type_id = EXCLUDED.type_id,
    current_status = EXCLUDED.current_status,
    housekeeping_status = EXCLUDED.housekeeping_status;

SELECT setval('room_types_type_id_seq', (SELECT COALESCE(MAX(type_id), 1) FROM room_types));
SELECT setval('rooms_room_id_seq', (SELECT COALESCE(MAX(room_id), 1) FROM rooms));
