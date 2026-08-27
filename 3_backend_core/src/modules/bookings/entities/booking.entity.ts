import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid', { name: 'booking_id' })
  booking_id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customer_id: string;

  @Column({ name: 'check_in_date', type: 'date' })
  check_in_date: string;

  @Column({ name: 'check_out_date', type: 'date' })
  check_out_date: string;

  @Column({ name: 'status', type: 'varchar', default: 'Confirmed' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;
}
