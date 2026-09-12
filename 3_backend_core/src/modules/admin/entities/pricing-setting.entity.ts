import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('pricing_settings')
export class PricingSetting {
  @PrimaryColumn({ name: 'setting_id', type: 'smallint' })
  setting_id: number;

  @Column({ name: 'ai_enabled', type: 'boolean', default: true })
  ai_enabled: boolean;

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updated_by: string | null;
}
