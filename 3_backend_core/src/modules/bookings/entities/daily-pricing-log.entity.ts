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

  @Column({ name: 'base_price', type: 'numeric', transformer: { to: (value: number) => value, from: (value: string) => Number(value) } })
  base_price: number;

  @Column({ name: 'final_price', type: 'numeric', transformer: { to: (value: number) => value, from: (value: string) => Number(value) } })
  final_price: number;

  @Column({ name: 'pricing_source', type: 'varchar', default: 'ai' })
  pricing_source: 'ai' | 'base';

  @Column({ name: 'settings_version', type: 'int' })
  settings_version: number;

  @Column({ name: 'ai_enabled', type: 'boolean' })
  ai_enabled: boolean;

  @Column({ name: 'ai_model_version', type: 'varchar', length: 100, nullable: true })
  ai_model_version: string | null;

  @Column({ name: 'ai_training_run_id', type: 'varchar', length: 100, nullable: true })
  ai_training_run_id: string | null;

  @Column({ name: 'ai_feature_contract_version', type: 'varchar', length: 50, nullable: true })
  ai_feature_contract_version: string | null;

  @Column({ name: 'room_type_name_snapshot', type: 'varchar' })
  room_type_name_snapshot: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}
