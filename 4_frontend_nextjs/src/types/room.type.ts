export interface RoomType {
  type_id: number;
  type_name: string;
  base_price: number;
  capacity: number;
}

export interface BookingResult {
  booking: { booking_id: string; check_in_date: string; check_out_date: string; status: string };
  room_id: number;
  room_number: string;
  applied_price: number;
  ai_multiplier: number;
  nights?: number;
  nightly_price?: number;
  total_price?: number;
}
