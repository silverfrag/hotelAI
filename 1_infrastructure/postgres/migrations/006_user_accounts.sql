-- Complete the customer account lifecycle without replacing existing rows.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS nationality VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_status VARCHAR(20);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS version INT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS auth_version INT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

UPDATE customers
SET account_status = CASE
      WHEN account_status IN ('Active', 'Suspended', 'Deactivated') THEN account_status
      ELSE 'Active'
    END,
    version = GREATEST(COALESCE(version, 1), 1),
    auth_version = GREATEST(COALESCE(auth_version, 1), 1),
    updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
WHERE account_status IS NULL
   OR account_status NOT IN ('Active', 'Suspended', 'Deactivated')
   OR version IS NULL OR version < 1
   OR auth_version IS NULL OR auth_version < 1
   OR updated_at IS NULL;

ALTER TABLE customers ALTER COLUMN account_status SET DEFAULT 'Active';
ALTER TABLE customers ALTER COLUMN account_status SET NOT NULL;
ALTER TABLE customers ALTER COLUMN version SET DEFAULT 1;
ALTER TABLE customers ALTER COLUMN version SET NOT NULL;
ALTER TABLE customers ALTER COLUMN auth_version SET DEFAULT 1;
ALTER TABLE customers ALTER COLUMN auth_version SET NOT NULL;
ALTER TABLE customers ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE customers ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_account_status_check;
ALTER TABLE customers ADD CONSTRAINT customers_account_status_check
  CHECK (account_status IN ('Active', 'Suspended', 'Deactivated'));
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_version_check;
ALTER TABLE customers ADD CONSTRAINT customers_version_check CHECK (version >= 1);
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_auth_version_check;
ALTER TABLE customers ADD CONSTRAINT customers_auth_version_check CHECK (auth_version >= 1);

CREATE TABLE IF NOT EXISTS customer_account_audits (
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

CREATE INDEX IF NOT EXISTS idx_customers_role_status_created_at
  ON customers (role, account_status, created_at DESC, customer_id DESC);
CREATE INDEX IF NOT EXISTS idx_customer_account_audits_customer_created_at
  ON customer_account_audits (customer_id, created_at DESC, audit_id DESC);
