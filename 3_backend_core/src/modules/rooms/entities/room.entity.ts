import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('room_types')
export class RoomType {
  @PrimaryGeneratedColumn({ name: 'type_id' })
  type_id: number;

  @Column({ name: 'name', type: 'varchar' })
  type_name: string;

  @Column({
    name: 'base_price',
    type: 'numeric',
    transformer: { to: (value: number) => value, from: (value: string) => Number(value) },
  })
  base_price: number;

  @Column({ name: 'capacity', type: 'int' })
  capacity: number;
}
