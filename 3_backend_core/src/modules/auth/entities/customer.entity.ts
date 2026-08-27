import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid', { name: 'customer_id' })
  customer_id: string;
  @Column({ name: 'full_name', type: 'varchar' }) full_name: string;
  @Column({ type: 'varchar' }) email: string;
  @Column({ name: 'password_hash', type: 'varchar', nullable: true, select: false }) password_hash: string | null;
  @Column({ type: 'varchar', default: 'customer' }) role: string;
  @CreateDateColumn({ name: 'created_at' }) created_at: Date;
}
