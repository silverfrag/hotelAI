-- Append-only manual payment/refund ledger. External gateways can later write
-- the same shape without changing historical booking totals.
CREATE TABLE IF NOT EXISTS payment_transactions (
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

CREATE INDEX IF NOT EXISTS idx_payment_transactions_booking_created_at
  ON payment_transactions (booking_id, created_at DESC, payment_id DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_parent
  ON payment_transactions (parent_payment_id)
  WHERE parent_payment_id IS NOT NULL;
