import { BookingForm } from '@/components/features/booking/BookingForm';
import { getRoomTypes } from '@/services/room.service';

export default async function HomePage() {
  const roomTypes = await getRoomTypes();

  return (
    <main>
      <h1>Hotel AI</h1>
      <p className="subtitle">
        Chọn phòng, ngày lưu trú và nhận giá được tính từ mô hình AI.
      </p>
      <section className="grid">
        {roomTypes.map((room) => (
          <article className="card" key={room.type_id}>
            <h2>{room.type_name}</h2>
            <p>{room.capacity} khách</p>
            <strong>Từ {room.base_price.toLocaleString('vi-VN')} VND/đêm</strong>
          </article>
        ))}
      </section>
      <BookingForm roomTypes={roomTypes} />
    </main>
  );
}
