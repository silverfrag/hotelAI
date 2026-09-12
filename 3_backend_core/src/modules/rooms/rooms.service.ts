import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RedisCacheService, ROOM_TYPES_CACHE_KEY } from '../../infrastructure/redis-cache.service';
import { RoomType } from './entities/room.entity';

export type PublicRoomType = RoomType & {
  total_rooms: number;
  available_now: number;
};

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(RoomType)
    private readonly roomsRepository: Repository<RoomType>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly cache: RedisCacheService,
  ) {}

  async findAllActiveRooms(): Promise<PublicRoomType[]> {
    const roomTypes = await this.loadRoomTypes();
    const availability = await this.loadCurrentAvailability();

    return roomTypes.map((roomType) => ({
      ...roomType,
      ...(availability.get(roomType.type_id) ?? { total_rooms: 0, available_now: 0 }),
    }));
  }

  private async loadRoomTypes(): Promise<RoomType[]> {
    const cached = await this.cache.getJson<RoomType[]>(ROOM_TYPES_CACHE_KEY);
    if (cached) return cached;
    const roomTypes = await this.roomsRepository.find({
      order: { base_price: 'ASC', type_id: 'ASC' },
    });
    const ttlSeconds = Math.max(
      5,
      Number(this.configService.get<string>('ROOM_CATALOG_CACHE_TTL_SECONDS', '300')),
    );
    await this.cache.setJson(ROOM_TYPES_CACHE_KEY, roomTypes, ttlSeconds);
    return roomTypes;
  }

  async findRoomType(typeId: number): Promise<PublicRoomType> {
    const roomType = await this.roomsRepository.findOne({ where: { type_id: typeId } });
    if (!roomType) {
      throw new NotFoundException(`Không tìm thấy loại phòng với ID: ${typeId}.`);
    }

    const availability = await this.loadCurrentAvailability(typeId);
    return {
      ...roomType,
      ...(availability.get(typeId) ?? { total_rooms: 0, available_now: 0 }),
    };
  }

  private async loadCurrentAvailability(typeId?: number) {
    const businessDate = this.getBusinessDate();
    const parameters = typeId === undefined ? [businessDate] : [businessDate, typeId];
    const filter = typeId === undefined ? '' : 'WHERE room.type_id = $2';
    const rows = await this.dataSource.query(
      `SELECT room.type_id,
              COUNT(*)::int AS total_rooms,
              COUNT(*) FILTER (
                WHERE room.current_status = 'Available'
                  AND room.housekeeping_status = 'Ready'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM booking_details detail
                    INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
                    WHERE detail.room_id = room.room_id
                      AND (booking.status IN ('Confirmed', 'CheckedIn')
                        OR (booking.status = 'Pending' AND booking.pending_expires_at > clock_timestamp()))
                      AND booking.check_in_date <= $1::date
                      AND booking.check_out_date > $1::date
                  )
              )::int AS available_now
       FROM rooms room
       ${filter}
       GROUP BY room.type_id`,
      parameters,
    ) as Array<{
      type_id: number;
      total_rooms: number | string;
      available_now: number | string;
    }>;

    return new Map(rows.map((row) => [
      Number(row.type_id),
      {
        total_rooms: Number(row.total_rooms),
        available_now: Number(row.available_now),
      },
    ]));
  }

  private getBusinessDate(now = new Date()): string {
    const timeZone = this.configService.get<string>('HOTEL_TIMEZONE', 'Asia/Bangkok');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
    return `${value.year}-${value.month}-${value.day}`;
  }
}
