INSERT INTO customers (customer_id, full_name, email, phone, nationality)
VALUES ('11111111-1111-4111-8111-111111111111', 'Demo Guest', 'guest@example.com', '0900000000', 'VN')
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO room_types (type_id, name, base_price, capacity)
VALUES
  (1, 'Deluxe King', 1200000, 2),
  (2, 'Family Suite', 2100000, 4)
ON CONFLICT (type_id) DO NOTHING;

INSERT INTO rooms (type_id, room_number, current_status)
VALUES
  (1, '101', 'Available'),
  (1, '102', 'Available'),
  (2, '201', 'Available')
ON CONFLICT (room_number) DO NOTHING;

SELECT setval('room_types_type_id_seq', (SELECT MAX(type_id) FROM room_types));
