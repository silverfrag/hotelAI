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
}
