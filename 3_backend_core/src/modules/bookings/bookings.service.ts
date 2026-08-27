import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { DataSource, Repository } from 'typeorm';
import { RoomType } from '../rooms/entities/room.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { Booking } from './entities/booking.entity';
import { BookingDetail } from './entities/booking-detail.entity';
import { DailyPricingLog } from './entities/daily-pricing-log.entity';
import { Room } from './entities/room.entity';

type AiPricingResponse = { status: string; ai_multiplier: number };

export type CreatedBooking = {
  booking: Booking;
  room_id: number;
  room_number: string;
  applied_price: number;
  nightly_price: number;
  nights: number;
  total_price: number;
  ai_multiplier: number;
};

export type BookingSummary = {
  booking_id: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  room_number: string;
  room_type: string;
  nightly_price: number;
  nights: number;
  total_price: number;
  created_at: Date;
};

export type CanceledBookingSummary = BookingSummary & {
  customer_id: string;
};

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(RoomType) private readonly roomTypeRepository: Repository<RoomType>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateBookingDto, customer_id: string): Promise<CreatedBooking> {
    const { room_type_id, check_in_date, check_out_date, total_of_special_requests } = dto;
    const businessDate = this.getBusinessDate();
    const today = new Date(`${businessDate}T00:00:00.000Z`);
    const checkIn = new Date(`${check_in_date}T00:00:00.000Z`);
    const checkOut = new Date(`${check_out_date}T00:00:00.000Z`);
    if (checkIn < today) throw new BadRequestException('Ngày nhận phòng không được nằm trong quá khứ.');
    if (checkOut <= checkIn) {
      throw new BadRequestException('Ngày trả phòng phải sau ngày nhận phòng.');
    }
    const leadTime = Math.floor((checkIn.getTime() - today.getTime()) / 86_400_000);

    const roomType = await this.roomTypeRepository.findOne({ where: { type_id: room_type_id } });
    if (!roomType) throw new NotFoundException(`Không tìm thấy loại phòng với ID: ${room_type_id}.`);

    const aiMultiplier = await this.getAiMultiplier({ check_in_date, lead_time: leadTime, total_of_special_requests });
    const nightlyPrice = Math.round(roomType.base_price * aiMultiplier * 100) / 100;
    const nights = Math.floor((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
    const totalPrice = Math.round(nightlyPrice * nights * 100) / 100;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query('SELECT pg_advisory_xact_lock($1)', [room_type_id]);
      const room = await queryRunner.manager.getRepository(Room).createQueryBuilder('room')
        .where('room.type_id = :roomTypeId', { roomTypeId: room_type_id })
        .andWhere("room.current_status <> 'Maintenance'")
        .andWhere((builder) => {
          const unavailable = builder.subQuery().select('1').from(BookingDetail, 'detail')
            .innerJoin(Booking, 'existingBooking', 'existingBooking.booking_id = detail.booking_id')
            .where('detail.room_id = room.room_id')
            .andWhere("existingBooking.status = 'Confirmed'")
            .andWhere('existingBooking.check_in_date < :checkOutDate')
            .andWhere('existingBooking.check_out_date > :checkInDate').getQuery();
          return `NOT EXISTS ${unavailable}`;
        })
        .setParameters({ checkInDate: check_in_date, checkOutDate: check_out_date })
        .setLock('pessimistic_write')
        .orderBy('room.room_number', 'ASC').getOne();
      if (!room) throw new NotFoundException('Không còn phòng trống trong khoảng ngày đã chọn.');

      const booking = await queryRunner.manager.save(Booking, {
        customer_id, check_in_date, check_out_date, status: 'Confirmed',
      });
      await queryRunner.manager.save(BookingDetail, {
        booking_id: booking.booking_id, room_id: room.room_id, applied_price: nightlyPrice,
      });
      await queryRunner.manager.save(DailyPricingLog, {
        booking_id: booking.booking_id,
        type_id: room_type_id,
        target_date: check_in_date,
        lead_time: leadTime,
        is_weekend: [0, 6].includes(checkIn.getUTCDay()),
        total_of_special_requests,
        ai_multiplier: aiMultiplier,
        final_price: nightlyPrice,
      });
      await queryRunner.commitTransaction();
      return { booking, room_id: room.room_id, room_number: room.room_number, applied_price: nightlyPrice, nightly_price: nightlyPrice, nights, total_price: totalPrice, ai_multiplier: aiMultiplier };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(customerId: string, role: string): Promise<BookingSummary[]> {
    const query = this.bookingRepository.createQueryBuilder('booking')
      .innerJoin(BookingDetail, 'detail', 'detail.booking_id = booking.booking_id')
      .innerJoin(Room, 'room', 'room.room_id = detail.room_id')
      .innerJoin(RoomType, 'roomType', 'roomType.type_id = room.type_id')
      .select('booking.booking_id', 'booking_id')
      .addSelect('booking.check_in_date', 'check_in_date')
      .addSelect('booking.check_out_date', 'check_out_date')
      .addSelect('booking.status', 'status')
      .addSelect('booking.created_at', 'created_at')
      .addSelect('room.room_number', 'room_number')
      .addSelect('roomType.name', 'room_type')
      .addSelect('detail.applied_price', 'nightly_price')
      .addSelect('(booking.check_out_date - booking.check_in_date)', 'nights')
      .addSelect('detail.applied_price * (booking.check_out_date - booking.check_in_date)', 'total_price')
      .orderBy('booking.created_at', 'DESC');
    if (role !== 'admin') query.where('booking.customer_id = :customerId', { customerId });
    const rows = await query.getRawMany<BookingSummary>();
    return rows.map((row) => ({ ...row, nightly_price: Number(row.nightly_price), nights: Number(row.nights), total_price: Number(row.total_price) }));
  }

  async cancel(bookingId: string, customerId: string, role: string): Promise<CanceledBookingSummary> {
    const businessDate = this.getBusinessDate();
    const isAdmin = role === 'admin';
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const ownershipCondition = isAdmin ? '' : 'AND customer_id = $3::uuid';
      const parameters = isAdmin ? [bookingId, businessDate] : [bookingId, businessDate, customerId];
      const updateResult = await queryRunner.query(
        `UPDATE bookings
         SET status = 'Canceled'
         WHERE booking_id = $1::uuid
           AND status = 'Confirmed'
           AND check_in_date > $2::date
           ${ownershipCondition}
         RETURNING booking_id`,
        parameters,
        true,
      );

      if (updateResult.affected !== 1) {
        const existingRows = await queryRunner.query(
          `SELECT booking_id, customer_id, check_in_date::text, status
           FROM bookings
           WHERE booking_id = $1::uuid`,
          [bookingId],
        );
        const existing = existingRows[0] as
          | { booking_id: string; customer_id: string; check_in_date: string; status: string }
          | undefined;

        if (!existing || (!isAdmin && existing.customer_id !== customerId)) {
          throw new NotFoundException('Không tìm thấy đặt phòng có thể truy cập.');
        }
        if (existing.status === 'Canceled') {
          throw new ConflictException('Đặt phòng đã được hủy trước đó.');
        }
        if (existing.status === 'Completed' || existing.check_in_date <= businessDate) {
          throw new ConflictException('Không thể hủy đặt phòng đã bắt đầu hoặc đã hoàn tất.');
        }
        throw new ConflictException('Chỉ có thể hủy đặt phòng đang ở trạng thái Confirmed.');
      }

      const summaryRows = await queryRunner.query(
        `SELECT booking.booking_id,
                booking.customer_id,
                booking.check_in_date::text,
                booking.check_out_date::text,
                booking.status,
                booking.created_at,
                room.room_number,
                room_type.name AS room_type,
                detail.applied_price AS nightly_price,
                (booking.check_out_date - booking.check_in_date) AS nights,
                detail.applied_price * (booking.check_out_date - booking.check_in_date) AS total_price
         FROM bookings booking
         INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
         INNER JOIN rooms room ON room.room_id = detail.room_id
         INNER JOIN room_types room_type ON room_type.type_id = room.type_id
         WHERE booking.booking_id = $1::uuid`,
        [bookingId],
      );
      const summary = summaryRows[0] as CanceledBookingSummary | undefined;
      if (!summary) throw new NotFoundException('Không tìm thấy chi tiết đặt phòng.');

      await queryRunner.commitTransaction();
      return {
        ...summary,
        nightly_price: Number(summary.nightly_price),
        nights: Number(summary.nights),
        total_price: Number(summary.total_price),
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async getAiMultiplier(input: { check_in_date: string; lead_time: number; total_of_special_requests: number }): Promise<number> {
    try {
      const checkIn = new Date(input.check_in_date);
      const { data } = await axios.post<AiPricingResponse>(
        this.configService.getOrThrow<string>('AI_SERVICE_URL'),
        {
          lead_time: input.lead_time,
          arrival_month: checkIn.getUTCMonth() + 1,
          is_weekend: [0, 6].includes(checkIn.getUTCDay()) ? 1 : 0,
          total_of_special_requests: input.total_of_special_requests,
        },
        { timeout: 5_000 },
      );
      // The training target is clipped to this interval. Reject an invalid or
      // compromised upstream response before it reaches NUMERIC(5, 3).
      if (!Number.isFinite(data.ai_multiplier) || data.ai_multiplier < 0.5 || data.ai_multiplier > 3) {
        throw new Error('Invalid multiplier');
      }
      return data.ai_multiplier;
    } catch {
      throw new ServiceUnavailableException('Không thể lấy giá động từ AI Pricing Service.');
    }
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
