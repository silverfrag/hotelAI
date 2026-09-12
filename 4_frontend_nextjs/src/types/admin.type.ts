import type {
  BookingPaymentSummary,
  BookingPolicySnapshot,
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
} from '@/types/booking.type';

export type RoomStatus = 'Available' | 'Occupied' | 'Maintenance';
export type HousekeepingStatus = 'Ready' | 'Dirty' | 'Cleaning';

export interface AdminRoom {
  room_id: number;
  room_number: string;
  current_status: RoomStatus;
  occupancy_booking_id: string | null;
  housekeeping_status: HousekeepingStatus;
  housekeeping_version: number;
  housekeeping_updated_at: string;
  type_id: number;
  type_name: string;
  base_price: number;
  capacity: number;
}

export interface AdminRoomType {
  type_id: number;
  type_name: string;
  base_price: number;
  capacity: number;
  room_count: number;
}

export type EditableRoomStatus = Exclude<RoomStatus, 'Occupied'>;

export interface CreateRoomInput {
  room_number: string;
  type_id: number;
  current_status?: EditableRoomStatus;
}

export type UpdateRoomInput = Partial<CreateRoomInput>;

export interface RoomTypeInput {
  name: string;
  base_price: number;
  capacity: number;
}

export interface PricingSettings {
  ai_enabled: boolean;
  updated_at: string | null;
  updated_by?: string | null;
  version: number;
}

export interface PricingLog {
  log_id: string;
  booking_id: string | null;
  type_id: number;
  type_name: string | null;
  target_date: string;
  lead_time: number | null;
  is_weekend: boolean | null;
  total_of_special_requests: number | null;
  ai_multiplier: number;
  final_price: number;
  pricing_source: string | null;
  base_price?: number | null;
  settings_version?: number | null;
  ai_enabled?: boolean | null;
  updated_at: string;
}

export interface PricingLogPage {
  items: PricingLog[];
  total: number;
  limit: number;
  offset: number;
}

export type AdminBookingStatus = BookingStatus;

export interface AdminBooking extends BookingPolicySnapshot {
  booking_id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  status: AdminBookingStatus;
  created_at: string;
  checked_in_at: string | null;
  checked_in_by: string | null;
  checked_out_at: string | null;
  checked_out_by: string | null;
  room_id: number;
  room_assignment_version: number;
  room_current_status: RoomStatus;
  housekeeping_status: HousekeepingStatus;
  housekeeping_version: number;
  housekeeping_updated_at: string;
  room_number_snapshot: string;
  room_type_name_snapshot: string;
  nightly_price: number;
  nights: number;
  total_price: number;
  can_cancel: boolean;
  can_check_in: boolean;
  can_check_out: boolean;
  can_mark_no_show: boolean;
  credit_authorized: number;
  payment_status: PaymentStatus;
  paid_amount: number;
  refunded_amount: number;
  net_paid: number;
  balance_due: number;
  refund_due: number;
}

export interface AdminBookingPage {
  items: AdminBooking[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminHousekeepingQueueItem {
  room_id: number;
  type_id: number;
  type_name: string;
  room_number: string;
  current_status: RoomStatus;
  occupancy_booking_id: string | null;
  housekeeping_status: HousekeepingStatus;
  housekeeping_version: number;
  housekeeping_updated_at: string;
}

export interface AdminHousekeepingPage {
  items: AdminHousekeepingQueueItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface UpdateHousekeepingStatusInput {
  target_status: HousekeepingStatus;
  expected_version: number;
  reason: string;
}

export interface AdminHousekeepingMutation {
  event_id: string;
  room_id: number;
  from_status: HousekeepingStatus;
  to_status: HousekeepingStatus;
  housekeeping_status: HousekeepingStatus;
  from_version: number;
  to_version: number;
  housekeeping_version: number;
  reason: string;
  changed_by: string;
  occurred_at: string;
}

export interface ReassignRoomInput {
  target_room_id: number;
  expected_assignment_version: number;
  reason: string;
}

export interface AdminRoomReassignment {
  event_id: string;
  booking_id: string;
  booking_detail_id: string;
  from_room_id: number;
  to_room_id: number;
  from_version: number;
  to_version: number;
  room_assignment_version: number;
  reason: string;
  changed_by: string;
  occurred_at: string;
}

export interface AdminPaymentTransaction extends PaymentTransaction {
  customer_id: string;
  customer_name: string;
  customer_email: string;
  booking_status: AdminBookingStatus;
}

export interface AdminPaymentPage {
  items: AdminPaymentTransaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface RecordPaymentInput {
  amount: number;
  method: PaymentMethod;
  idempotency_key: string;
  external_reference?: string;
  note?: string;
}

export interface RefundPaymentInput {
  amount: number;
  idempotency_key: string;
  note?: string;
}

export interface PaymentMutationResult {
  replayed: boolean;
  transaction: PaymentTransaction;
  summary: BookingPaymentSummary;
}

export interface AdminDashboardSummary {
  total_bookings: number;
  confirmed_bookings: number;
  checked_in_bookings: number;
  completed_bookings: number;
  canceled_bookings: number;
  pending_bookings: number;
  expired_bookings: number;
  no_show_bookings: number;
  booking_value: number;
  customer_count: number;
  room_count: number;
}

export interface AdminMonthlyBookingValue {
  month: string;
  booking_count: number;
  booking_value: number;
}

export interface AdminRoomStatusBreakdown {
  status: RoomStatus;
  room_count: number;
}

export interface AdminDashboard {
  business_date: string;
  timezone: string;
  summary: AdminDashboardSummary;
  monthly_revenue: AdminMonthlyBookingValue[];
  room_status_breakdown: AdminRoomStatusBreakdown[];
  pricing_setting: PricingSettings;
  recent_bookings: AdminBooking[];
}

export type AdminUserRole = 'customer' | 'admin';
export type AdminUserStatus = 'Active' | 'Suspended' | 'Deactivated';

export interface AdminUser {
  customer_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  nationality: string | null;
  role: AdminUserRole;
  account_status: AdminUserStatus;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  booking_count: number;
  confirmed_booking_count: number;
  checked_in_booking_count: number;
  active_booking_count: number;
  booking_value: number;
}

export interface AdminUserPage {
  items: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminUserAudit {
  audit_id: string;
  action: 'profile_updated' | 'password_changed' | 'account_updated' | 'deactivated';
  old_role: AdminUserRole | null;
  new_role: AdminUserRole | null;
  old_status: AdminUserStatus | null;
  new_status: AdminUserStatus | null;
  old_version: number;
  new_version: number;
  changed_fields: { fields?: string[]; source?: string };
  changed_by: string;
  changed_by_name: string;
  changed_by_email: string;
  created_at: string;
}

export interface AdminUserAuditPage {
  items: AdminUserAudit[];
  total: number;
  limit: number;
  offset: number;
}

export interface SmartUpgradeRecommendation {
  booking_id: string;
  customer_name: string;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  nights: number;
  expected_assignment_version: number;
  current_room: {
    room_id: number;
    room_number: string;
    type_id: number;
    type_name: string;
    base_price: number;
  };
  recommended_room: {
    room_id: number;
    room_number: string;
    type_id: number;
    type_name: string;
    base_price: number;
  };
  upgrade_delta_value: number;
  occupancy_boost_reason: string;
  confidence_score: number;
}

export interface ExecuteUpgradeInput {
  booking_id: string;
  target_room_id: number;
  expected_assignment_version: number;
  reason: string;
}

