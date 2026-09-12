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

  @Column({ name: 'room_number_snapshot', type: 'varchar' })
  room_number_snapshot: string;

  @Column({ name: 'room_type_name_snapshot', type: 'varchar' })
  room_type_name_snapshot: string;

  @Column({ name: 'room_assignment_version', type: 'int', default: 1 })
  room_assignment_version: number;
}
