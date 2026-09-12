import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type CustomerRole = 'customer' | 'admin';
export type CustomerAccountStatus = 'Active' | 'Suspended' | 'Deactivated';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid', { name: 'customer_id' })
  customer_id: string;
  @Column({ name: 'full_name', type: 'varchar' }) full_name: string;
  @Column({ type: 'varchar' }) email: string;
  @Column({ type: 'varchar', nullable: true }) phone: string | null;
  @Column({ type: 'varchar', nullable: true }) nationality: string | null;
  @Column({ name: 'password_hash', type: 'varchar', nullable: true, select: false }) password_hash: string | null;
  @Column({ type: 'varchar', default: 'customer' }) role: CustomerRole;
  @Column({ name: 'account_status', type: 'varchar', default: 'Active' }) account_status: CustomerAccountStatus;
  @Column({ type: 'int', default: 1 }) version: number;
  @Column({ name: 'auth_version', type: 'int', default: 1 }) auth_version: number;
  @CreateDateColumn({ name: 'created_at' }) created_at: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updated_at: Date;
  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true }) deleted_at: Date | null;
}
