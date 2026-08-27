ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'customer';

UPDATE customers SET role = 'customer' WHERE role IS NULL OR role NOT IN ('customer', 'admin');
ALTER TABLE customers ALTER COLUMN role SET DEFAULT 'customer';
ALTER TABLE customers ALTER COLUMN role SET NOT NULL;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_role_check;
ALTER TABLE customers ADD CONSTRAINT customers_role_check CHECK (role IN ('customer', 'admin'));
