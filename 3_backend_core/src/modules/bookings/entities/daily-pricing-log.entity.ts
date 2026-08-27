import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('daily_pricing_logs')
export class DailyPricingLog {
  @PrimaryGeneratedColumn('uuid', { name: 'log_id' })
  log_id: string;

  // Nullable only for audit rows created before migration 002.
  @Column({ name: 'booking_id', type: 'uuid', nullable: true })
  booking_id: string | null;

  @Column({ name: 'type_id', type: 'int' })
  type_id: number;

  @Column({ name: 'target_date', type: 'date' })
  target_date: string;

  @Column({ name: 'lead_time', type: 'int', nullable: true })
  lead_time: number | null;

  @Column({ name: 'is_weekend', type: 'boolean', nullable: true })
  is_weekend: boolean | null;

  @Column({ name: 'total_of_special_requests', type: 'int', nullable: true })
  total_of_special_requests: number | null;

  @Column({ name: 'ai_multiplier', type: 'numeric', transformer: { to: (value: number) => value, from: (value: string) => Number(value) } })
  ai_multiplier: number;

  @Column({ name: 'final_price', type: 'numeric', transformer: { to: (value: number) => value, from: (value: string) => Number(value) } })
  final_price: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}
