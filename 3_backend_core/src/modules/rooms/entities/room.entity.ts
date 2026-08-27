import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('room_types')
export class RoomType {
  @PrimaryGeneratedColumn({ name: 'type_id' })
  type_id: number;

  @Column({ name: 'name', type: 'varchar' }) // <-- Đổi thành 'name' cho khớp DB
  type_name: string; // Tên thuộc tính trong code vẫn giữ là type_name hoặc name tùy ý

  @Column({
    name: 'base_price',
    type: 'numeric',
    transformer: { to: (value: number) => value, from: (value: string) => Number(value) },
  })
  base_price: number;

  @Column({ name: 'capacity', type: 'int' })
  capacity: number;
}
