import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('booking_details')
export class BookingDetail {
  @PrimaryGeneratedColumn('uuid', { name: 'detail_id' })
  detail_id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  booking_id: string;

  @Column({ name: 'room_id', type: 'int' })
  room_id: number;

  @Column({ name: 'applied_price', type: 'numeric', transformer: { to: (value: number) => value, from: (value: string) => Number(value) } })
  applied_price: number;
}
