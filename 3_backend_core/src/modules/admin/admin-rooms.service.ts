import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { getPostgresErrorCode } from '../../common/utils/postgres-error';
import { RedisCacheService, ROOM_TYPES_CACHE_KEY } from '../../infrastructure/redis-cache.service';
import { Room } from '../bookings/entities/room.entity';
import { RoomType } from '../rooms/entities/room.entity';
import { CreatePhysicalRoomDto, RoomStatus, UpdatePhysicalRoomDto } from './dto/physical-room.dto';
import { CreateRoomTypeDto, UpdateRoomTypeDto } from './dto/room-type.dto';

export type AdminRoomTypeView = {
  type_id: number;
  type_name: string;
  base_price: number;
  capacity: number;
  room_count: number;
};

export type AdminPhysicalRoomView = {
  room_id: number;
  room_number: string;
  current_status: string;
  housekeeping_status: string;
  housekeeping_version: number;
  housekeeping_updated_at: Date;
  occupancy_booking_id: string | null;
  type_id: number;
  type_name: string;
  base_price: number;
  capacity: number;
};

@Injectable()
export class AdminRoomsService {
  constructor(
    @InjectRepository(RoomType) private readonly roomTypes: Repository<RoomType>,
    @InjectRepository(Room) private readonly rooms: Repository<Room>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly cache: RedisCacheService,
  ) {}

  async listRoomTypes(): Promise<AdminRoomTypeView[]> {
    const rows = await this.dataSource.query(
      `SELECT room_type.type_id,
              room_type.name AS type_name,
              room_type.base_price,
              room_type.capacity,
              COUNT(room.room_id)::int AS room_count
       FROM room_types room_type
       LEFT JOIN rooms room ON room.type_id = room_type.type_id
       GROUP BY room_type.type_id, room_type.name, room_type.base_price, room_type.capacity
       ORDER BY room_type.base_price ASC, room_type.type_id ASC`,
    );
    return rows.map((row: Record<string, unknown>) => this.mapRoomType(row));
  }

  async createRoomType(dto: CreateRoomTypeDto): Promise<AdminRoomTypeView> {
    try {
      const saved = await this.roomTypes.save(
        this.roomTypes.create({ type_name: dto.name, base_price: dto.base_price, capacity: dto.capacity }),
      );
      await this.cache.delete(ROOM_TYPES_CACHE_KEY);
      return this.getRoomType(saved.type_id);
    } catch (error) {
      this.mapWriteError(error, 'Tên loại phòng đã tồn tại.');
    }
  }

  async updateRoomType(typeId: number, dto: UpdateRoomTypeDto): Promise<AdminRoomTypeView> {
    this.requirePatch(dto);
    const roomType = await this.roomTypes.findOne({ where: { type_id: typeId } });
    if (!roomType) throw new NotFoundException('Không tìm thấy loại phòng.');

    if (dto.name !== undefined) roomType.type_name = dto.name;
    if (dto.base_price !== undefined) roomType.base_price = dto.base_price;
    if (dto.capacity !== undefined) roomType.capacity = dto.capacity;

    try {
      await this.roomTypes.save(roomType);
      await this.cache.delete(ROOM_TYPES_CACHE_KEY);
      return this.getRoomType(typeId);
    } catch (error) {
      this.mapWriteError(error, 'Tên loại phòng đã tồn tại.');
    }
  }

  async deleteRoomType(typeId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const existing = await manager.query('SELECT type_id FROM room_types WHERE type_id = $1 FOR UPDATE', [typeId]);
      if (!existing.length) throw new NotFoundException('Không tìm thấy loại phòng.');

      const references = await manager.query(
        `SELECT
           (SELECT COUNT(*)::int FROM rooms WHERE type_id = $1) AS room_count,
           (SELECT COUNT(*)::int FROM daily_pricing_logs WHERE type_id = $1) AS pricing_log_count`,
        [typeId],
      );
      if (Number(references[0].room_count) > 0 || Number(references[0].pricing_log_count) > 0) {
        throw new ConflictException('Không thể xóa loại phòng đang được phòng vật lý hoặc lịch sử giá tham chiếu.');
      }

      try {
        await manager.query('DELETE FROM room_types WHERE type_id = $1', [typeId]);
      } catch (error) {
        this.mapWriteError(error, 'Không thể xóa loại phòng đang được tham chiếu.');
      }
    });
    await this.cache.delete(ROOM_TYPES_CACHE_KEY);
  }

  async listPhysicalRooms(): Promise<AdminPhysicalRoomView[]> {
    const rows = await this.dataSource.query(
      `SELECT room.room_id,
              room.room_number,
              room.current_status,
              room.housekeeping_status,
              room.housekeeping_version,
              room.housekeeping_updated_at,
              room.occupancy_booking_id,
              room_type.type_id,
              room_type.name AS type_name,
              room_type.base_price,
              room_type.capacity
       FROM rooms room
       INNER JOIN room_types room_type ON room_type.type_id = room.type_id
       ORDER BY room.room_number ASC, room.room_id ASC`,
    );
    return rows.map((row: Record<string, unknown>) => this.mapPhysicalRoom(row));
  }

  async createPhysicalRoom(dto: CreatePhysicalRoomDto): Promise<AdminPhysicalRoomView> {
    if (dto.current_status === RoomStatus.Occupied) {
      throw new BadRequestException('Chỉ thao tác nhận phòng mới có thể chuyển phòng sang Occupied.');
    }
    await this.assertRoomTypeExists(dto.type_id);
    try {
      const saved = await this.rooms.save(
        this.rooms.create({
          type_id: dto.type_id,
          room_number: dto.room_number,
          current_status: dto.current_status ?? RoomStatus.Available,
        }),
      );
      return this.getPhysicalRoom(saved.room_id);
    } catch (error) {
      this.mapWriteError(error, 'Số phòng đã tồn tại.');
    }
  }

  async updatePhysicalRoom(roomId: number, dto: UpdatePhysicalRoomDto): Promise<AdminPhysicalRoomView> {
    this.requirePatch(dto);
    return this.dataSource.transaction(async (manager) => {
      // Serialize admin room mutations, then acquire the same room-type lock as
      // booking creation before locking the physical row. This prevents a room
      // from becoming Maintenance between availability selection and booking.
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [941, 1]);
      const initialRows = await manager.query(
        `SELECT room_id, type_id, room_number, current_status, occupancy_booking_id
         FROM rooms WHERE room_id = $1`,
        [roomId],
      );
      if (!initialRows.length) throw new NotFoundException('Không tìm thấy phòng vật lý.');

      const currentTypeId = Number(initialRows[0].type_id);
      const lockTypeIds = [...new Set([currentTypeId, dto.type_id ?? currentTypeId])].sort((a, b) => a - b);
      for (const typeId of lockTypeIds) {
        await manager.query('SELECT pg_advisory_xact_lock($1)', [typeId]);
      }

      const room = await manager.getRepository(Room).findOne({
        where: { room_id: roomId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!room) throw new NotFoundException('Không tìm thấy phòng vật lý.');

      if (dto.current_status === RoomStatus.Occupied) {
        throw new BadRequestException('Chỉ thao tác nhận phòng mới có thể chuyển phòng sang Occupied.');
      }
      if (room.occupancy_booking_id !== null) {
        throw new ConflictException('Không thể chỉnh sửa phòng khi đang gắn với một booking lưu trú.');
      }

      if (dto.type_id !== undefined) {
        const typeExists = await manager.getRepository(RoomType).exists({ where: { type_id: dto.type_id } });
        if (!typeExists) throw new NotFoundException('Không tìm thấy loại phòng.');
      }

      if (dto.current_status === RoomStatus.Maintenance && room.current_status !== RoomStatus.Maintenance) {
        const businessDate = this.getBusinessDate();
        const activeBookings = await manager.query(
          `SELECT EXISTS (
             SELECT 1
             FROM booking_details detail
             INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
             WHERE detail.room_id = $1
               AND (booking.status IN ('Confirmed', 'CheckedIn')
                 OR (booking.status = 'Pending' AND booking.pending_expires_at > clock_timestamp()))
               AND booking.check_out_date > $2::date
           ) AS has_active_booking`,
          [roomId, businessDate],
        );
        if (activeBookings[0].has_active_booking) {
          throw new ConflictException(
            'Không thể chuyển phòng sang Maintenance khi còn đặt phòng đang diễn ra hoặc trong tương lai.',
          );
        }
      }

      if (dto.type_id !== undefined) room.type_id = dto.type_id;
      if (dto.room_number !== undefined) room.room_number = dto.room_number;
      if (dto.current_status !== undefined) room.current_status = dto.current_status;

      try {
        await manager.getRepository(Room).save(room);
        return this.getPhysicalRoom(roomId, manager);
      } catch (error) {
        this.mapWriteError(error, 'Số phòng đã tồn tại.');
      }
    });
  }

  async deletePhysicalRoom(roomId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const existing = await manager.query('SELECT room_id FROM rooms WHERE room_id = $1 FOR UPDATE', [roomId]);
      if (!existing.length) throw new NotFoundException('Không tìm thấy phòng vật lý.');

      const references = await manager.query(
        'SELECT COUNT(*)::int AS booking_count FROM booking_details WHERE room_id = $1',
        [roomId],
      );
      if (Number(references[0].booking_count) > 0) {
        throw new ConflictException('Không thể xóa phòng đã xuất hiện trong lịch sử đặt phòng.');
      }

      try {
        await manager.query('DELETE FROM rooms WHERE room_id = $1', [roomId]);
      } catch (error) {
        this.mapWriteError(error, 'Không thể xóa phòng đang được tham chiếu.');
      }
    });
  }

  private async assertRoomTypeExists(typeId: number): Promise<void> {
    if (!(await this.roomTypes.exists({ where: { type_id: typeId } }))) {
      throw new NotFoundException('Không tìm thấy loại phòng.');
    }
  }

  private async getRoomType(typeId: number, manager?: EntityManager): Promise<AdminRoomTypeView> {
    const runner = manager ?? this.dataSource;
    const rows = await runner.query(
      `SELECT room_type.type_id,
              room_type.name AS type_name,
              room_type.base_price,
              room_type.capacity,
              COUNT(room.room_id)::int AS room_count
       FROM room_types room_type
       LEFT JOIN rooms room ON room.type_id = room_type.type_id
       WHERE room_type.type_id = $1
       GROUP BY room_type.type_id, room_type.name, room_type.base_price, room_type.capacity`,
      [typeId],
    );
    if (!rows.length) throw new NotFoundException('Không tìm thấy loại phòng.');
    return this.mapRoomType(rows[0]);
  }

  private async getPhysicalRoom(roomId: number, manager?: EntityManager): Promise<AdminPhysicalRoomView> {
    const runner = manager ?? this.dataSource;
    const rows = await runner.query(
      `SELECT room.room_id,
              room.room_number,
              room.current_status,
              room.housekeeping_status,
              room.housekeeping_version,
              room.housekeeping_updated_at,
              room.occupancy_booking_id,
              room_type.type_id,
              room_type.name AS type_name,
              room_type.base_price,
              room_type.capacity
       FROM rooms room
       INNER JOIN room_types room_type ON room_type.type_id = room.type_id
       WHERE room.room_id = $1`,
      [roomId],
    );
    if (!rows.length) throw new NotFoundException('Không tìm thấy phòng vật lý.');
    return this.mapPhysicalRoom(rows[0]);
  }

  private mapRoomType(row: Record<string, unknown>): AdminRoomTypeView {
    return {
      type_id: Number(row.type_id),
      type_name: String(row.type_name),
      base_price: Number(row.base_price),
      capacity: Number(row.capacity),
      room_count: Number(row.room_count),
    };
  }

  private mapPhysicalRoom(row: Record<string, unknown>): AdminPhysicalRoomView {
    return {
      room_id: Number(row.room_id),
      room_number: String(row.room_number),
      current_status: String(row.current_status),
      housekeeping_status: String(row.housekeeping_status),
      housekeeping_version: Number(row.housekeeping_version),
      housekeeping_updated_at: row.housekeeping_updated_at as Date,
      occupancy_booking_id:
        row.occupancy_booking_id === null ? null : String(row.occupancy_booking_id),
      type_id: Number(row.type_id),
      type_name: String(row.type_name),
      base_price: Number(row.base_price),
      capacity: Number(row.capacity),
    };
  }

  private requirePatch(dto: object): void {
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException('Cần cung cấp ít nhất một trường để cập nhật.');
    }
  }

  private mapWriteError(error: unknown, uniqueMessage: string): never {
    const code = getPostgresErrorCode(error);
    if (code === '23505') throw new ConflictException(uniqueMessage);
    if (code === '23503') throw new ConflictException('Không thể thay đổi dữ liệu đang được tham chiếu.');
    throw error;
  }

  private getBusinessDate(now = new Date()): string {
    const timeZone = this.configService.get<string>('HOTEL_TIMEZONE', 'Asia/Bangkok');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
}
