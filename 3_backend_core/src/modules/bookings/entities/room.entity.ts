import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn({ name: 'room_id' })
  room_id: number;

  @Column({ name: 'type_id', type: 'int' })
  type_id: number;

  @Column({ name: 'room_number', type: 'varchar' })
  room_number: string;

  @Column({ name: 'current_status', type: 'varchar' })
  current_status: string;

  @Column({ name: 'housekeeping_status', type: 'varchar', default: 'Ready' })
  housekeeping_status: string;

  @Column({ name: 'housekeeping_version', type: 'int', default: 1 })
  housekeeping_version: number;

  @Column({
    name: 'housekeeping_updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  housekeeping_updated_at: Date;

  @Column({ name: 'occupancy_booking_id', type: 'uuid', nullable: true })
  occupancy_booking_id: string | null;
}
