import type { BookingPolicySnapshot, BookingStatus, PaymentStatus } from '@/types/booking.type';

export interface RoomType {
  type_id: number;
  type_name: string;
  base_price: number;
  capacity: number;
  declared_max_price?: number | null;
  total_rooms: number;
  available_now: number;
}

export interface PublicCoupon {
  code: string;
  description_vi: string;
  discount_pct: number;
  max_discount_vnd: number;
  min_room_type_id: number;
  usage_limit: number;
  used_count: number;
  active: boolean;
  expiry_date: string | null;
}

export interface PricingFactorItem {
  factor_name: string;
  source_category: '(A) ML_REAL_DATA' | '(B) SIMULATED_SYSTEM_STATE' | '(C) SIMULATED_ASSUMPTION' | '(D) BUSINESS_RULE';
  impact_pct: number;
  impact_vnd: number;
  description_vi: string;
}

export interface PricingBreakdown {
  base_price: number;
  ml_reference_price: number;
  pre_coupon_nightly_price: number;
  pre_coupon_total_price: number;
  declared_max_price: number | null;
  is_ceiling_clamped: boolean;
  coupon_code: string | null;
  coupon_description_vi: string | null;
  coupon_discount_per_night_vnd: number;
  coupon_discount_total_vnd: number;
  is_floor_price_clamped: boolean;
  floor_price_vnd: number;
  factors: PricingFactorItem[];
}

export interface PriceQuote {
  quote_id: string;
  room_type: Pick<RoomType, 'type_id' | 'type_name' | 'base_price' | 'capacity' | 'declared_max_price'>;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  nights: number;
  rooms_available: number;
  rooms_sellable: number;
  rooms_booked: number;
  occupancy_ratio: number;
  inventory_snapshot_at: string;
  ai_multiplier: number;
  ai_model_version: string | null;
  ai_training_run_id: string | null;
  ai_feature_contract_version: string | null;
  pricing_source: 'ai' | 'base';
  settings_version: number;
  nightly_price: number;
  total_price: number;
  coupon_code?: string | null;
  coupon_discount_vnd?: number;
  pre_coupon_total_price?: number;
  is_floor_price_clamped?: boolean;
  pricing_breakdown?: PricingBreakdown | null;
  currency: 'VND';
  is_estimate: true;
  availability_is_guaranteed: false;
  created_at: string;
  expires_at: string;
  price_guaranteed_until: string;
}

export type QuoteClientEvent = 'quote.exposed.v1' | 'quote.rejected.v1';

export interface QuoteTrackingContext {
  session_id: string;
  search_id: string;
}

export interface QuoteEventResult extends QuoteTrackingContext {
  quote_event_id: string;
  quote_id: string;
  event_type: QuoteClientEvent;
  occurred_at: string;
  replayed: boolean;
}

export interface BookingResult {
  booking: BookingPolicySnapshot & {
    booking_id: string;
    check_in_date: string;
    check_out_date: string;
    guest_count: number;
    status: BookingStatus;
  };
  quote_id: string | null;
  room_id: number;
  room_number: string;
  applied_price: number;
  ai_multiplier: number;
  pricing_source: 'ai' | 'base';
  settings_version: number;
  nights?: number;
  nightly_price?: number;
  total_price?: number;
  coupon_code?: string | null;
  coupon_discount_vnd?: number;
  pre_coupon_total_price?: number;
  is_floor_price_clamped?: boolean;
  payment_status: PaymentStatus;
  paid_amount: number;
  balance_due: number;
}
