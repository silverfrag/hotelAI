INSERT INTO customers (customer_id, full_name, email, phone, nationality)
VALUES ('11111111-1111-4111-8111-111111111111', 'Demo Guest', 'guest@example.com', '0900000000', 'VN')
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO room_types (type_id, name, base_price, capacity)
VALUES
  (1, 'Deluxe King', 1200000, 2),
  (2, 'Family Suite', 2100000, 4),
  (3, 'Premier Twin Retreat', 1600000, 2),
  (4, 'Executive Ocean Suite', 2800000, 2),
  (5, 'Panoramic Sunrise Suite', 3600000, 3),
  (6, 'Wellness & Spa Villa', 4900000, 2),
  (7, 'Royal Penthouse Suite', 8500000, 4),
  (8, 'Presidential Beachfront Villa', 15000000, 6)
ON CONFLICT (type_id) DO UPDATE
SET name = EXCLUDED.name, base_price = EXCLUDED.base_price, capacity = EXCLUDED.capacity;

-- Kho phòng chuẩn 5 sao Luxury Resort Việt Nam (98 phòng vật lý)
INSERT INTO rooms (type_id, room_number, current_status, housekeeping_status)
VALUES
  -- 1. Deluxe King (Type 1): 24 phòng (Tầng 1-2 King Wing)
  (1, '101', 'Available', 'Ready'),
  (1, '102', 'Available', 'Ready'),
  (1, '103', 'Available', 'Ready'),
  (1, '104', 'Available', 'Ready'),
  (1, '105', 'Available', 'Ready'),
  (1, '106', 'Available', 'Ready'),
  (1, '107', 'Available', 'Ready'),
  (1, '108', 'Available', 'Ready'),
  (1, '109', 'Available', 'Ready'),
  (1, '110', 'Available', 'Ready'),
  (1, '111', 'Available', 'Ready'),
  (1, '112', 'Available', 'Ready'),
  (1, '201', 'Available', 'Ready'),
  (1, '202', 'Available', 'Ready'),
  (1, '203', 'Available', 'Ready'),
  (1, '204', 'Available', 'Ready'),
  (1, '205', 'Available', 'Ready'),
  (1, '206', 'Available', 'Ready'),
  (1, '207', 'Available', 'Ready'),
  (1, '208', 'Available', 'Ready'),
  (1, '209', 'Available', 'Ready'),
  (1, '210', 'Available', 'Ready'),
  (1, '211', 'Available', 'Ready'),
  (1, '212', 'Available', 'Ready'),

  -- 2. Premier Twin Retreat (Type 3): 18 phòng (Tầng 1-2 Twin Wing)
  (3, '113', 'Available', 'Ready'),
  (3, '114', 'Available', 'Ready'),
  (3, '115', 'Available', 'Ready'),
  (3, '116', 'Available', 'Ready'),
  (3, '117', 'Available', 'Ready'),
  (3, '118', 'Available', 'Ready'),
  (3, '119', 'Available', 'Ready'),
  (3, '120', 'Available', 'Ready'),
  (3, '213', 'Available', 'Ready'),
  (3, '214', 'Available', 'Ready'),
  (3, '215', 'Available', 'Ready'),
  (3, '216', 'Available', 'Ready'),
  (3, '217', 'Available', 'Ready'),
  (3, '218', 'Available', 'Ready'),
  (3, '219', 'Available', 'Ready'),
  (3, '220', 'Available', 'Ready'),
  (3, '221', 'Available', 'Ready'),
  (3, '222', 'Available', 'Ready'),

  -- 3. Family Suite (Type 2): 16 phòng (Tầng 3 Family Wing)
  (2, '301', 'Available', 'Ready'),
  (2, '302', 'Available', 'Ready'),
  (2, '303', 'Available', 'Ready'),
  (2, '304', 'Available', 'Ready'),
  (2, '305', 'Available', 'Ready'),
  (2, '306', 'Available', 'Ready'),
  (2, '307', 'Available', 'Ready'),
  (2, '308', 'Available', 'Ready'),
  (2, '309', 'Available', 'Ready'),
  (2, '310', 'Available', 'Ready'),
  (2, '311', 'Available', 'Ready'),
  (2, '312', 'Available', 'Ready'),
  (2, '313', 'Available', 'Ready'),
  (2, '314', 'Available', 'Ready'),
  (2, '315', 'Available', 'Ready'),
  (2, '316', 'Available', 'Ready'),

  -- 4. Executive Ocean Suite (Type 4): 14 phòng (Tầng 4 Ocean Wing)
  (4, '401', 'Available', 'Ready'),
  (4, '402', 'Available', 'Ready'),
  (4, '403', 'Available', 'Ready'),
  (4, '404', 'Available', 'Ready'),
  (4, '405', 'Available', 'Ready'),
  (4, '406', 'Available', 'Ready'),
  (4, '407', 'Available', 'Ready'),
  (4, '408', 'Available', 'Ready'),
  (4, '409', 'Available', 'Ready'),
  (4, '410', 'Available', 'Ready'),
  (4, '411', 'Available', 'Ready'),
  (4, '412', 'Available', 'Ready'),
  (4, '413', 'Available', 'Ready'),
  (4, '414', 'Available', 'Ready'),

  -- 5. Panoramic Sunrise Suite (Type 5): 12 phòng (Tầng 5 Sunrise Wing)
  (5, '501', 'Available', 'Ready'),
  (5, '502', 'Available', 'Ready'),
  (5, '503', 'Available', 'Ready'),
  (5, '504', 'Available', 'Ready'),
  (5, '505', 'Available', 'Ready'),
  (5, '506', 'Available', 'Ready'),
  (5, '507', 'Available', 'Ready'),
  (5, '508', 'Available', 'Ready'),
  (5, '509', 'Available', 'Ready'),
  (5, '510', 'Available', 'Ready'),
  (5, '511', 'Available', 'Ready'),
  (5, '512', 'Available', 'Ready'),

  -- 6. Wellness & Spa Villa (Type 6): 8 căn biệt thự biệt lập (Spa Garden Zone)
  (6, 'V101', 'Available', 'Ready'),
  (6, 'V102', 'Available', 'Ready'),
  (6, 'V103', 'Available', 'Ready'),
  (6, 'V104', 'Available', 'Ready'),
  (6, 'V105', 'Available', 'Ready'),
  (6, 'V106', 'Available', 'Ready'),
  (6, 'V107', 'Available', 'Ready'),
  (6, 'V108', 'Available', 'Ready'),

  -- 7. Royal Penthouse Suite (Type 7): 4 căn Penthouse đỉnh tháp (Floor 6 Penthouse Wing)
  (7, 'P601', 'Available', 'Ready'),
  (7, 'P602', 'Available', 'Ready'),
  (7, 'P603', 'Available', 'Ready'),
  (7, 'P604', 'Available', 'Ready'),

  -- 8. Presidential Beachfront Villa (Type 8): 2 căn Siêu Biệt Thự Trực Diện Biển
  (8, 'PV01', 'Available', 'Ready'),
  (8, 'PV02', 'Available', 'Ready')
ON CONFLICT (room_number) DO UPDATE
SET type_id = EXCLUDED.type_id,
    current_status = EXCLUDED.current_status,
    housekeeping_status = EXCLUDED.housekeeping_status;

SELECT setval('room_types_type_id_seq', (SELECT MAX(type_id) FROM room_types));
SELECT setval('rooms_room_id_seq', (SELECT MAX(room_id) FROM rooms));
