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

  @Column({ name: 'guest_count', type: 'int', default: 1 })
  guest_count: number;

  @Column({ name: 'status', type: 'varchar', default: 'Confirmed' })
  status: string;

  @Column({ type: 'int', nullable: true })
  policy_version: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  deposit_required: number;

  @Column({ type: 'boolean', default: false })
  checkout_payment_required: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  pending_expires_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expired_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  no_show_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  no_show_by: string | null;

  @Column({ type: 'text', nullable: true })
  no_show_reason: string | null;

  @Column({ type: 'int', default: 1 })
  lifecycle_version: number;

  @Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
  checked_in_at: Date | null;

  @Column({ name: 'checked_in_by', type: 'uuid', nullable: true })
  checked_in_by: string | null;

  @Column({ name: 'checked_out_at', type: 'timestamptz', nullable: true })
  checked_out_at: Date | null;

  @Column({ name: 'checked_out_by', type: 'uuid', nullable: true })
  checked_out_by: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;
}
