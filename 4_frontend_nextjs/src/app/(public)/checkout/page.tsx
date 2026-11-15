import { randomUUID } from 'node:crypto';
import { CheckoutForm } from '@/components/features/booking/CheckoutForm';
import { getRoomTypes } from '@/services/room.service';
import { addIsoDays, getHotelBusinessDate } from '@/utils/businessDate';

export const metadata = {
  title: 'Báo giá và đặt phòng | White Sand Boutique Hotel Đà Nẵng',
  description: 'Kiểm tra tồn phòng White Sand Boutique Hotel Đà Nẵng, áp mã ưu đãi, nhận báo giá thông minh và xác nhận đặt phòng.',
};

interface CheckoutPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const [roomTypes, query] = await Promise.all([getRoomTypes(), searchParams]);
  const businessDate = getHotelBusinessDate();
  const requestedTypeId = Number(first(query.room_type_id));
  const initialRoomTypeId = roomTypes.some((room) => room.type_id === requestedTypeId)
    ? requestedTypeId
    : roomTypes[0]?.type_id ?? 0;
  const requestedCheckIn = first(query.check_in_date) ?? '';
  const initialCheckInDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedCheckIn) && requestedCheckIn >= businessDate
    ? requestedCheckIn
    : businessDate;
  const requestedCheckOut = first(query.check_out_date) ?? '';
  const initialCheckOutDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedCheckOut) && requestedCheckOut > initialCheckInDate
    ? requestedCheckOut
    : addIsoDays(initialCheckInDate, 1);
  const requestedGuestCount = Number(first(query.guest_count));
  const selectedCapacity = roomTypes.find((room) => room.type_id === initialRoomTypeId)?.capacity ?? 1;
  const initialGuestCount = Number.isInteger(requestedGuestCount) && requestedGuestCount >= 1 && requestedGuestCount <= selectedCapacity
    ? requestedGuestCount
    : 1;
  const requestedRequests = Number(first(query.requests));
  const initialRequests = Number.isInteger(requestedRequests) && requestedRequests >= 0 && requestedRequests <= 5
    ? requestedRequests
    : 0;
  const requestedSearchId = first(query.search_id) ?? '';
  const initialSearchId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(requestedSearchId)
    ? requestedSearchId
    : randomUUID();

  return (
    <main className="public-main checkout-page">
      <header className="public-page-header checkout-header">
        <p className="eyebrow">Báo giá và xác nhận</p>
        <h1>Hoàn tất kỳ nghỉ của bạn</h1>
        <p>Giá được cập nhật khi bạn đổi thông tin. Phòng chỉ được giữ sau khi xác nhận thành công.</p>
      </header>
      <CheckoutForm
        roomTypes={roomTypes}
        businessDate={businessDate}
        initialRoomTypeId={initialRoomTypeId}
        initialCheckInDate={initialCheckInDate}
        initialCheckOutDate={initialCheckOutDate}
        initialGuestCount={initialGuestCount}
        initialRequests={initialRequests}
        initialSearchId={initialSearchId}
      />
    </main>
  );
}
