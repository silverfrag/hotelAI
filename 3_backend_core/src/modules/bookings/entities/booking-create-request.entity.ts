import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('booking_create_requests')
export class BookingCreateRequest {
  @PrimaryColumn({ name: 'customer_id', type: 'uuid' })
  customer_id: string;

  @PrimaryColumn({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotency_key: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  request_hash: string;

  @Column({ name: 'booking_id', type: 'uuid', unique: true })
  booking_id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at: Date;
}
