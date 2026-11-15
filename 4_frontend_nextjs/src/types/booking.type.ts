export type PaymentStatus =
  | 'Unpaid'
  | 'PartiallyPaid'
  | 'Paid'
  | 'RefundPending'
  | 'PartiallyRefunded'
  | 'Refunded';

export type PaymentMethod = 'Cash' | 'BankTransfer' | 'CardTerminal';
export type PaymentTransactionType = 'Payment' | 'Refund';
export type BookingStatus = 'Pending' | 'Confirmed' | 'CheckedIn' | 'Completed' | 'Canceled' | 'Expired' | 'NoShow';

export interface BookingPolicySnapshot {
  lifecycle_version: number;
  policy_version: number | null;
  deposit_required: number;
  checkout_payment_required: boolean;
  pending_expires_at: string | null;
}

export interface BookingFinancialStatus extends BookingPolicySnapshot {
  booking_id: string;
  customer_id: string;
  status: BookingStatus;
  check_in_date: string;
  check_out_date: string;
  expired_at: string | null;
  no_show_at: string | null;
  hold_expired: boolean;
  booking_total: number;
  net_paid: number;
  deposit_due: number;
  balance_due: number;
  refund_due: number;
  credit_authorized: number;
  can_check_out: boolean;
}

export interface PaymentTransaction {
  payment_id: string;
  booking_id: string;
  transaction_type: PaymentTransactionType;
  parent_payment_id: string | null;
  amount: number;
  currency: 'VND';
  method: PaymentMethod;
  status: 'Succeeded';
  idempotency_key: string;
  external_reference: string | null;
  note: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  refunded_amount: number;
  refundable_amount: number;
}

export interface BookingPaymentSummary extends BookingPolicySnapshot {
  booking_id: string;
  booking_status: BookingStatus;
  deposit_due: number;
  expired_at: string | null;
  no_show_at: string | null;
  hold_expired: boolean;
  can_record_payment: boolean;
  booking_total: number;
  paid_amount: number;
  refunded_amount: number;
  net_paid: number;
  balance_due: number;
  refund_due: number;
  payment_status: PaymentStatus;
  currency: 'VND';
  transactions: PaymentTransaction[];
}

export interface BookingSummary extends BookingPolicySnapshot {
  booking_id: string;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  status: BookingStatus;
  room_number: string;
  room_type: string;
  nightly_price: number;
  nights: number;
  total_price: number;
  created_at: string;
  can_cancel: boolean;
  payment_status: PaymentStatus;
  paid_amount: number;
  refunded_amount: number;
  net_paid: number;
  balance_due: number;
  refund_due: number;
}

export interface CustomerNotification {
  notification_id: string;
  booking_id: string;
  kind: string;
  payload: {
    status?: string | null;
    pending_expires_at?: string | null;
    deposit_required?: number | string | null;
  };
  created_at: string;
  read_at: string | null;
}

export interface CustomerNotificationsPage {
  data: CustomerNotification[];
  total: number;
  unread: number;
  limit: number;
  offset: number;
}
