import type { BookingPolicySnapshot, BookingStatus, PaymentStatus } from '@/types/booking.type';

export interface RoomType {
  type_id: number;
  type_name: string;
  base_price: number;
  capacity: number;
  total_rooms: number;
  available_now: number;
}

export interface PriceQuote {
  quote_id: string;
  room_type: Pick<RoomType, 'type_id' | 'type_name' | 'base_price' | 'capacity'>;
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
  payment_status: PaymentStatus;
  paid_amount: number;
  balance_due: number;
}
