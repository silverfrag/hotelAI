export interface BookingSummary {
  booking_id: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  room_number: string;
  room_type: string;
  nightly_price: number;
  nights: number;
  total_price: number;
  created_at: string;
}

