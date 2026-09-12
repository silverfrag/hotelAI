import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { getPostgresErrorCode } from '../../common/utils/postgres-error';
import { OutboxService } from '../../infrastructure/outbox.service';
import {
  ExecuteUpgradeDto,
  HousekeepingQueueQueryDto,
  HousekeepingStatus,
  ReassignRoomDto,
  SmartUpgradeRecommendation,
  UpdateHousekeepingStatusDto,
} from './dto/room-turnover.dto';

type RoomState = {
  room_id: number | string;
  type_id: number | string;
  room_number: string;
  current_status: string;
  occupancy_booking_id: string | null;
  housekeeping_status: HousekeepingStatus;
  housekeeping_version: number | string;
  housekeeping_updated_at: Date | string;
};

type HousekeepingEventRow = {
  event_id: string;
  room_id: number | string;
  from_status: HousekeepingStatus;
  to_status: HousekeepingStatus;
  from_version: number | string;
  to_version: number | string;
  reason: string;
  idempotency_key: string;
  changed_by: string;
  occurred_at: Date | string;
};

type AssignmentEventRow = {
  event_id: string;
  booking_id: string;
  booking_detail_id: string;
  from_room_id: number | string;
  to_room_id: number | string;
  from_version: number | string;
  to_version: number | string;
  reason: string;
  idempotency_key: string;
  changed_by: string;
  occurred_at: Date | string;
};

type LockedBookingAssignment = {
  booking_id: string;
  customer_id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  booking_detail_id: string;
  room_id: number | string;
  room_assignment_version: number | string;
  applied_price: number | string;
  room_number_snapshot: string;
  room_type_name_snapshot: string;
  current_room_type_id: number | string;
  quote_id: string | null;
  pricing_type_id: number | string | null;
  pricing_source: string | null;
  settings_version: number | string | null;
  ai_model_version: string | null;
  ai_training_run_id: string | null;
  ai_feature_contract_version: string | null;
};

export type HousekeepingQueueItem = {
  room_id: number;
  type_id: number;
  type_name: string;
  room_number: string;
  current_status: string;
  occupancy_booking_id: string | null;
  housekeeping_status: HousekeepingStatus;
  housekeeping_version: number;
  housekeeping_updated_at: string;
};

export type HousekeepingMutationView = {
  event_id: string;
  room_id: number;
  from_status: HousekeepingStatus;
  to_status: HousekeepingStatus;
  housekeeping_status: HousekeepingStatus;
  from_version: number;
  to_version: number;
  housekeeping_version: number;
  reason: string;
  changed_by: string;
  occurred_at: string;
};

export type RoomReassignmentView = {
  event_id: string;
  booking_id: string;
  booking_detail_id: string;
  from_room_id: number;
  to_room_id: number;
  from_version: number;
  to_version: number;
  room_assignment_version: number;
  reason: string;
  changed_by: string;
  occurred_at: string;
};

@Injectable()
export class AdminRoomTurnoverService {
  private readonly validTransitions: Readonly<Record<HousekeepingStatus, readonly HousekeepingStatus[]>> = {
    [HousekeepingStatus.Ready]: [HousekeepingStatus.Dirty],
    [HousekeepingStatus.Dirty]: [HousekeepingStatus.Cleaning],
    [HousekeepingStatus.Cleaning]: [HousekeepingStatus.Ready, HousekeepingStatus.Dirty],
  };

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly outbox: OutboxService,
  ) {}

  async listHousekeeping(query: HousekeepingQueueQueryDto): Promise<{
    data: HousekeepingQueueItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const parameters: unknown[] = [query.status ?? null];
    const [rows, countRows] = await Promise.all([
      this.dataSource.query(
        `SELECT room.room_id,
                room.type_id,
                room_type.name AS type_name,
                room.room_number,
                room.current_status,
                room.occupancy_booking_id,
                room.housekeeping_status,
                room.housekeeping_version,
                room.housekeeping_updated_at
         FROM rooms room
         INNER JOIN room_types room_type ON room_type.type_id = room.type_id
         WHERE ($1::varchar IS NULL OR room.housekeeping_status = $1)
         ORDER BY CASE room.housekeeping_status
                    WHEN 'Dirty' THEN 0
                    WHEN 'Cleaning' THEN 1
                    ELSE 2
                  END,
                  room.housekeeping_updated_at ASC,
                  room.room_number ASC,
                  room.room_id ASC
         LIMIT $2 OFFSET $3`,
        [...parameters, query.limit, query.offset],
      ) as Promise<Array<Record<string, unknown>>>,
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total
         FROM rooms room
         WHERE ($1::varchar IS NULL OR room.housekeeping_status = $1)`,
        parameters,
      ) as Promise<Array<{ total: number | string }>>,
    ]);

    return {
      data: rows.map((row) => this.mapQueueItem(row)),
      total: Number(countRows[0]?.total ?? 0),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async updateHousekeepingStatus(
    roomId: number,
    dto: UpdateHousekeepingStatusDto,
    actorId: string,
    rawIdempotencyKey?: string,
  ): Promise<HousekeepingMutationView> {
    const idempotencyKey = this.normalizeIdempotencyKey(rawIdempotencyKey);

    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [941, 1]);
        await this.lockIdempotencyKey(manager, 'housekeeping', roomId, idempotencyKey);

        const replay = await this.findHousekeepingReplay(manager, roomId, idempotencyKey);
        if (replay) {
          this.assertHousekeepingReplay(replay, dto);
          return this.mapHousekeepingEvent(replay);
        }

        const initialRows = await manager.query(
          `SELECT type_id
           FROM rooms
           WHERE room_id = $1`,
          [roomId],
        ) as Array<{ type_id: number | string }>;
        if (!initialRows[0]) throw new NotFoundException('Không tìm thấy phòng vật lý.');

        await manager.query('SELECT pg_advisory_xact_lock($1)', [Number(initialRows[0].type_id)]);
        const room = await this.lockRoom(manager, roomId);
        const currentVersion = Number(room.housekeeping_version);

        if (currentVersion !== dto.expected_version) {
          throw new ConflictException(
            'Trạng thái housekeeping đã được cập nhật ở nơi khác. Hãy tải lại dữ liệu.',
          );
        }
        if (room.current_status === 'Occupied' || room.occupancy_booking_id !== null) {
          throw new ConflictException('Không thể thay đổi housekeeping khi phòng đang có khách.');
        }
        if (!this.validTransitions[room.housekeeping_status]?.includes(dto.target_status)) {
          throw new ConflictException(
            `Không thể chuyển housekeeping từ ${room.housekeeping_status} sang ${dto.target_status}.`,
          );
        }

        const event = await this.insertHousekeepingEvent(manager, {
          roomId,
          fromStatus: room.housekeeping_status,
          toStatus: dto.target_status,
          fromVersion: currentVersion,
          reason: dto.reason,
          idempotencyKey,
          actorId,
        });
        const updatedRows = await manager.query(
          `UPDATE rooms
           SET housekeeping_status = $2,
               housekeeping_version = $3,
               housekeeping_updated_at = CURRENT_TIMESTAMP
           WHERE room_id = $1
             AND housekeeping_status = $4
             AND housekeeping_version = $5
             AND current_status <> 'Occupied'
             AND occupancy_booking_id IS NULL
           RETURNING room_id`,
          [
            roomId,
            dto.target_status,
            currentVersion + 1,
            room.housekeeping_status,
            currentVersion,
          ],
        );
        if (this.affectedRows(updatedRows) !== 1) {
          throw new ConflictException(
            'Trạng thái phòng đã thay đổi đồng thời. Hãy tải lại dữ liệu.',
          );
        }

        await this.outbox.enqueue(manager, {
          aggregateType: 'room',
          aggregateId: roomId,
          eventType: 'room.housekeeping-status-changed.v1',
          payload: {
            event_id: event.event_id,
            room_id: roomId,
            room_type_id: Number(room.type_id),
            room_number: room.room_number,
            from_status: event.from_status,
            to_status: event.to_status,
            from_version: Number(event.from_version),
            to_version: Number(event.to_version),
            reason: event.reason,
            changed_by: event.changed_by,
            occurred_at: this.toIsoString(event.occurred_at),
          },
        });
        return this.mapHousekeepingEvent(event);
      });
    } catch (error) {
      this.rethrowWriteError(error);
    }
  }

  async reassignRoom(
    bookingId: string,
    dto: ReassignRoomDto,
    actorId: string,
    rawIdempotencyKey?: string,
  ): Promise<RoomReassignmentView> {
    const idempotencyKey = this.normalizeIdempotencyKey(rawIdempotencyKey);

    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [941, 1]);
        await this.lockIdempotencyKey(manager, 'room-reassignment', bookingId, idempotencyKey);

        const replay = await this.findAssignmentReplay(manager, bookingId, idempotencyKey);
        if (replay) {
          this.assertAssignmentReplay(replay, dto);
          return this.mapAssignmentEvent(replay);
        }

        const assignment = await this.lockBookingAssignment(manager, bookingId);
        const sourceRoomId = Number(assignment.room_id);
        if (sourceRoomId === dto.target_room_id) {
          throw new ConflictException('Phòng đích đang là phòng hiện tại của booking.');
        }
        if (Number(assignment.room_assignment_version) !== dto.expected_assignment_version) {
          throw new ConflictException(
            'Phân phòng đã được cập nhật ở nơi khác. Hãy tải lại dữ liệu.',
          );
        }
        if (!['Confirmed', 'CheckedIn'].includes(assignment.status)) {
          throw new ConflictException('Chỉ có thể đổi phòng cho booking Confirmed hoặc CheckedIn.');
        }

        const targetTypeRows = await manager.query(
          `SELECT type_id
           FROM rooms
           WHERE room_id = $1`,
          [dto.target_room_id],
        ) as Array<{ type_id: number | string }>;
        if (!targetTypeRows[0]) throw new NotFoundException('Không tìm thấy phòng đích.');

        const typeIds = [...new Set([
          Number(assignment.current_room_type_id),
          Number(targetTypeRows[0].type_id),
        ])].sort((left, right) => left - right);
        for (const typeId of typeIds) {
          await manager.query('SELECT pg_advisory_xact_lock($1)', [typeId]);
        }

        const rooms = await this.lockRooms(manager, [sourceRoomId, dto.target_room_id]);
        const sourceRoom = rooms.get(sourceRoomId);
        const targetRoom = rooms.get(dto.target_room_id);
        if (!sourceRoom) {
          throw new ConflictException('Phòng hiện tại của booking không còn tồn tại.');
        }
        if (!targetRoom) throw new NotFoundException('Không tìm thấy phòng đích.');
        if (dto.is_upgrade) {
          const roomTypes = (await manager.query(
            `SELECT type_id, base_price, capacity, name FROM room_types WHERE type_id IN ($1, $2)`,
            [Number(sourceRoom.type_id), Number(targetRoom.type_id)],
          )) as Array<{ type_id: number | string; base_price: number | string; capacity: number; name: string }>;
          const sourceType = roomTypes.find((t) => Number(t.type_id) === Number(sourceRoom.type_id));
          const targetType = roomTypes.find((t) => Number(t.type_id) === Number(targetRoom.type_id));
          if (!sourceType || !targetType) throw new NotFoundException('Không tìm thấy thông tin loại phòng.');
          if (Number(targetType.base_price) < Number(sourceType.base_price)) {
            throw new ConflictException('Nâng hạng phòng yêu cầu loại phòng đích có giá trị bằng hoặc cao hơn.');
          }
          await manager.query("SELECT set_config('hotelai.allow_room_upgrade', 'on', true)");
        } else {
          if (Number(sourceRoom.type_id) !== Number(targetRoom.type_id)) {
            throw new ConflictException('Phòng đích phải cùng loại với phòng hiện tại.');
          }
          if (
            assignment.pricing_type_id !== null
            && Number(assignment.pricing_type_id) !== Number(targetRoom.type_id)
          ) {
            throw new ConflictException('Loại phòng đích không khớp snapshot định giá của booking.');
          }
        }
        if (targetRoom.current_status === 'Maintenance') {
          throw new ConflictException('Không thể đổi booking sang phòng đang bảo trì.');
        }

        await this.assertNoBookingOverlap(
          manager,
          bookingId,
          dto.target_room_id,
          assignment.check_in_date,
          assignment.check_out_date,
        );

        const businessDate = this.getBusinessDate();
        const requiresReadyNow = assignment.status === 'CheckedIn'
          || (
            assignment.check_in_date <= businessDate
            && assignment.check_out_date > businessDate
          );
        if (
          requiresReadyNow
          && (
            targetRoom.current_status !== 'Available'
            || targetRoom.occupancy_booking_id !== null
            || targetRoom.housekeeping_status !== HousekeepingStatus.Ready
          )
        ) {
          throw new ConflictException('Phòng đích phải Available và Ready cho lượt lưu trú hiện tại.');
        }
        if (
          assignment.status === 'CheckedIn'
          && (
            sourceRoom.current_status !== 'Occupied'
            || sourceRoom.occupancy_booking_id !== bookingId
          )
        ) {
          throw new ConflictException('Phòng nguồn không còn được gắn với booking đang lưu trú.');
        }
        if (
          assignment.status === 'CheckedIn'
          && sourceRoom.housekeeping_status !== HousekeepingStatus.Ready
        ) {
          throw new ConflictException('Trạng thái housekeeping của phòng nguồn không hợp lệ.');
        }

        const assignmentEvent = await this.insertAssignmentEvent(manager, {
          assignment,
          targetRoomId: dto.target_room_id,
          reason: dto.reason,
          idempotencyKey,
          actorId,
        });

        const updatedDetails = await manager.query(
          `UPDATE booking_details
           SET room_id = $2,
               room_number_snapshot = $3,
               room_assignment_version = $4,
               room_type_name_snapshot = COALESCE((SELECT name FROM room_types WHERE type_id = $7), room_type_name_snapshot)
           WHERE detail_id = $1::uuid
             AND room_id = $5
             AND room_assignment_version = $6
           RETURNING detail_id`,
          [
            assignment.booking_detail_id,
            dto.target_room_id,
            targetRoom.room_number,
            dto.expected_assignment_version + 1,
            sourceRoomId,
            dto.expected_assignment_version,
            Number(targetRoom.type_id),
          ],
        );
        if (this.affectedRows(updatedDetails) !== 1) {
          throw new ConflictException('Phân phòng đã thay đổi đồng thời. Hãy tải lại dữ liệu.');
        }

        let housekeepingEvent: HousekeepingEventRow | null = null;
        if (assignment.status === 'CheckedIn') {
          const conflictingHousekeepingReplay = await this.findHousekeepingReplay(
            manager,
            sourceRoomId,
            idempotencyKey,
          );
          if (conflictingHousekeepingReplay) {
            throw new ConflictException(
              'Idempotency-Key đã được dùng cho một thao tác housekeeping khác.',
            );
          }
          housekeepingEvent = await this.insertHousekeepingEvent(manager, {
            roomId: sourceRoomId,
            fromStatus: HousekeepingStatus.Ready,
            toStatus: HousekeepingStatus.Dirty,
            fromVersion: Number(sourceRoom.housekeeping_version),
            reason: dto.reason,
            idempotencyKey,
            actorId,
          });

          const releasedSource = await manager.query(
            `UPDATE rooms
             SET current_status = 'Available',
                 occupancy_booking_id = NULL,
                 housekeeping_status = 'Dirty',
                 housekeeping_version = $3,
                 housekeeping_updated_at = CURRENT_TIMESTAMP
             WHERE room_id = $1
               AND current_status = 'Occupied'
               AND occupancy_booking_id = $2::uuid
               AND housekeeping_status = 'Ready'
               AND housekeeping_version = $4
             RETURNING room_id`,
            [
              sourceRoomId,
              bookingId,
              Number(sourceRoom.housekeeping_version) + 1,
              Number(sourceRoom.housekeeping_version),
            ],
          );
          if (this.affectedRows(releasedSource) !== 1) {
            throw new ConflictException('Phòng nguồn đã thay đổi đồng thời. Hãy tải lại dữ liệu.');
          }

          const occupiedTarget = await manager.query(
            `UPDATE rooms
             SET current_status = 'Occupied',
                 occupancy_booking_id = $2::uuid
             WHERE room_id = $1
               AND current_status = 'Available'
               AND occupancy_booking_id IS NULL
               AND housekeeping_status = 'Ready'
             RETURNING room_id`,
            [dto.target_room_id, bookingId],
          );
          if (this.affectedRows(occupiedTarget) !== 1) {
            throw new ConflictException('Phòng đích đã thay đổi đồng thời. Hãy tải lại dữ liệu.');
          }
        }

        await this.outbox.enqueue(manager, {
          aggregateType: 'booking',
          aggregateId: bookingId,
          eventType: 'booking.room-reassigned.v1',
          payload: {
            event_id: assignmentEvent.event_id,
            booking_id: bookingId,
            booking_detail_id: assignment.booking_detail_id,
            booking_status: assignment.status,
            customer_id: assignment.customer_id,
            from_room_id: sourceRoomId,
            to_room_id: dto.target_room_id,
            from_room_number: assignment.room_number_snapshot,
            to_room_number: targetRoom.room_number,
            from_version: Number(assignmentEvent.from_version),
            to_version: Number(assignmentEvent.to_version),
            check_in_date: assignment.check_in_date,
            check_out_date: assignment.check_out_date,
            applied_price: Number(assignment.applied_price),
            room_type_name_snapshot: assignment.room_type_name_snapshot,
            quote_id: assignment.quote_id,
            pricing_source: assignment.pricing_source,
            settings_version:
              assignment.settings_version === null ? null : Number(assignment.settings_version),
            ai_model_version: assignment.ai_model_version,
            ai_training_run_id: assignment.ai_training_run_id,
            ai_feature_contract_version: assignment.ai_feature_contract_version,
            reason: dto.reason,
            changed_by: actorId,
            occurred_at: this.toIsoString(assignmentEvent.occurred_at),
          },
        });

        if (housekeepingEvent) {
          await this.outbox.enqueue(manager, {
            aggregateType: 'room',
            aggregateId: sourceRoomId,
            eventType: 'room.housekeeping-status-changed.v1',
            payload: {
              event_id: housekeepingEvent.event_id,
              room_id: sourceRoomId,
              room_type_id: Number(sourceRoom.type_id),
              room_number: sourceRoom.room_number,
              from_status: housekeepingEvent.from_status,
              to_status: housekeepingEvent.to_status,
              from_version: Number(housekeepingEvent.from_version),
              to_version: Number(housekeepingEvent.to_version),
              reason: housekeepingEvent.reason,
              changed_by: housekeepingEvent.changed_by,
              occurred_at: this.toIsoString(housekeepingEvent.occurred_at),
              source: 'booking-room-reassignment',
              booking_id: bookingId,
            },
          });
        }

        return this.mapAssignmentEvent(assignmentEvent);
      });
    } catch (error) {
      this.rethrowWriteError(error);
    }
  }

  private async lockRoom(manager: EntityManager, roomId: number): Promise<RoomState> {
    const rows = await manager.query(
      `SELECT room_id,
              type_id,
              room_number,
              current_status,
              occupancy_booking_id,
              housekeeping_status,
              housekeeping_version,
              housekeeping_updated_at
       FROM rooms
       WHERE room_id = $1
       FOR UPDATE`,
      [roomId],
    ) as RoomState[];
    if (!rows[0]) throw new NotFoundException('Không tìm thấy phòng vật lý.');
    return rows[0];
  }

  private async lockRooms(
    manager: EntityManager,
    roomIds: number[],
  ): Promise<Map<number, RoomState>> {
    const uniqueIds = [...new Set(roomIds)].sort((left, right) => left - right);
    const rows = await manager.query(
      `SELECT room_id,
              type_id,
              room_number,
              current_status,
              occupancy_booking_id,
              housekeeping_status,
              housekeeping_version,
              housekeeping_updated_at
       FROM rooms
       WHERE room_id = ANY($1::int[])
       ORDER BY room_id ASC
       FOR UPDATE`,
      [uniqueIds],
    ) as RoomState[];
    return new Map(rows.map((room) => [Number(room.room_id), room]));
  }

  private async lockBookingAssignment(
    manager: EntityManager,
    bookingId: string,
  ): Promise<LockedBookingAssignment> {
    const rows = await manager.query(
      `SELECT booking.booking_id,
              booking.customer_id,
              booking.status,
              booking.check_in_date::text,
              booking.check_out_date::text,
              detail.detail_id AS booking_detail_id,
              detail.room_id,
              detail.room_assignment_version,
              detail.applied_price,
              detail.room_number_snapshot,
              detail.room_type_name_snapshot,
              current_room.type_id AS current_room_type_id,
              quote.quote_id,
              pricing.type_id AS pricing_type_id,
              pricing.pricing_source,
              pricing.settings_version,
              pricing.ai_model_version,
              pricing.ai_training_run_id,
              pricing.ai_feature_contract_version
       FROM bookings booking
       INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
       INNER JOIN rooms current_room ON current_room.room_id = detail.room_id
       LEFT JOIN daily_pricing_logs pricing ON pricing.booking_id = booking.booking_id
       LEFT JOIN pricing_quotes quote ON quote.booking_id = booking.booking_id
       WHERE booking.booking_id = $1::uuid
       ORDER BY detail.detail_id
       FOR UPDATE OF booking, detail`,
      [bookingId],
    ) as LockedBookingAssignment[];
    if (!rows.length) throw new NotFoundException('Không tìm thấy booking.');
    if (rows.length !== 1) {
      throw new ConflictException('Booking có nhiều chi tiết phòng nên không thể dùng thao tác đổi phòng đơn.');
    }
    return rows[0];
  }

  private async assertNoBookingOverlap(
    manager: EntityManager,
    bookingId: string,
    targetRoomId: number,
    checkInDate: string,
    checkOutDate: string,
  ): Promise<void> {
    const rows = await manager.query(
      `SELECT EXISTS (
         SELECT 1
         FROM booking_details detail
         INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
         WHERE detail.room_id = $1
           AND booking.booking_id <> $2::uuid
           AND (booking.status IN ('Confirmed', 'CheckedIn')
             OR (booking.status = 'Pending' AND booking.pending_expires_at > clock_timestamp()))
           AND booking.check_in_date < $4::date
           AND booking.check_out_date > $3::date
       ) AS has_overlap`,
      [targetRoomId, bookingId, checkInDate, checkOutDate],
    ) as Array<{ has_overlap: boolean | string }>;
    if (this.asBoolean(rows[0]?.has_overlap)) {
      throw new ConflictException('Phòng đích đã có booking trùng khoảng lưu trú.');
    }
  }

  private async insertHousekeepingEvent(
    manager: EntityManager,
    input: {
      roomId: number;
      fromStatus: HousekeepingStatus;
      toStatus: HousekeepingStatus;
      fromVersion: number;
      reason: string;
      idempotencyKey: string;
      actorId: string;
    },
  ): Promise<HousekeepingEventRow> {
    const rows = await manager.query(
      `INSERT INTO room_housekeeping_events (
         room_id,
         from_status,
         to_status,
         from_version,
         to_version,
         reason,
         idempotency_key,
         changed_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid)
       RETURNING event_id,
                 room_id,
                 from_status,
                 to_status,
                 from_version,
                 to_version,
                 reason,
                 idempotency_key,
                 changed_by,
                 occurred_at`,
      [
        input.roomId,
        input.fromStatus,
        input.toStatus,
        input.fromVersion,
        input.fromVersion + 1,
        input.reason,
        input.idempotencyKey,
        input.actorId,
      ],
    ) as HousekeepingEventRow[];
    return rows[0];
  }

  private async insertAssignmentEvent(
    manager: EntityManager,
    input: {
      assignment: LockedBookingAssignment;
      targetRoomId: number;
      reason: string;
      idempotencyKey: string;
      actorId: string;
    },
  ): Promise<AssignmentEventRow> {
    const fromVersion = Number(input.assignment.room_assignment_version);
    const rows = await manager.query(
      `INSERT INTO booking_room_assignment_events (
         booking_id,
         booking_detail_id,
         from_room_id,
         to_room_id,
         from_version,
         to_version,
         reason,
         idempotency_key,
         changed_by
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid)
       RETURNING event_id,
                 booking_id,
                 booking_detail_id,
                 from_room_id,
                 to_room_id,
                 from_version,
                 to_version,
                 reason,
                 idempotency_key,
                 changed_by,
                 occurred_at`,
      [
        input.assignment.booking_id,
        input.assignment.booking_detail_id,
        Number(input.assignment.room_id),
        input.targetRoomId,
        fromVersion,
        fromVersion + 1,
        input.reason,
        input.idempotencyKey,
        input.actorId,
      ],
    ) as AssignmentEventRow[];
    return rows[0];
  }

  private async findHousekeepingReplay(
    manager: EntityManager,
    roomId: number,
    idempotencyKey: string,
  ): Promise<HousekeepingEventRow | null> {
    const rows = await manager.query(
      `SELECT event_id,
              room_id,
              from_status,
              to_status,
              from_version,
              to_version,
              reason,
              idempotency_key,
              changed_by,
              occurred_at
       FROM room_housekeeping_events
       WHERE room_id = $1
         AND idempotency_key = $2
       ORDER BY occurred_at ASC, event_id ASC`,
      [roomId, idempotencyKey],
    ) as HousekeepingEventRow[];
    return rows[0] ?? null;
  }

  private async findAssignmentReplay(
    manager: EntityManager,
    bookingId: string,
    idempotencyKey: string,
  ): Promise<AssignmentEventRow | null> {
    const rows = await manager.query(
      `SELECT event_id,
              booking_id,
              booking_detail_id,
              from_room_id,
              to_room_id,
              from_version,
              to_version,
              reason,
              idempotency_key,
              changed_by,
              occurred_at
       FROM booking_room_assignment_events
       WHERE booking_id = $1::uuid
         AND idempotency_key = $2
       ORDER BY occurred_at ASC, event_id ASC`,
      [bookingId, idempotencyKey],
    ) as AssignmentEventRow[];
    if (rows.length > 1) {
      throw new ConflictException('Idempotency-Key khớp nhiều lịch sử phân phòng không hợp lệ.');
    }
    return rows[0] ?? null;
  }

  private assertHousekeepingReplay(
    event: HousekeepingEventRow,
    dto: UpdateHousekeepingStatusDto,
  ): void {
    if (
      event.to_status !== dto.target_status
      || Number(event.from_version) !== dto.expected_version
      || event.reason !== dto.reason
    ) {
      throw new ConflictException(
        'Idempotency-Key đã được dùng cho một yêu cầu housekeeping khác.',
      );
    }
  }

  private assertAssignmentReplay(event: AssignmentEventRow, dto: ReassignRoomDto): void {
    if (
      Number(event.to_room_id) !== dto.target_room_id
      || Number(event.from_version) !== dto.expected_assignment_version
      || event.reason !== dto.reason
    ) {
      throw new ConflictException('Idempotency-Key đã được dùng cho một yêu cầu đổi phòng khác.');
    }
  }

  private async lockIdempotencyKey(
    manager: EntityManager,
    operation: string,
    aggregateId: string | number,
    idempotencyKey: string,
  ): Promise<void> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`hotelai:${operation}:${aggregateId}:${idempotencyKey}`],
    );
  }

  private normalizeIdempotencyKey(rawKey?: string): string {
    if (rawKey === undefined) {
      throw new BadRequestException('Thiếu header Idempotency-Key.');
    }
    const key = rawKey.trim();
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key phải dài 8-100 ký tự và chỉ gồm chữ, số, dấu chấm, gạch dưới, hai chấm hoặc gạch nối.',
      );
    }
    return key;
  }

  private mapQueueItem(row: Record<string, unknown>): HousekeepingQueueItem {
    return {
      room_id: Number(row.room_id),
      type_id: Number(row.type_id),
      type_name: String(row.type_name),
      room_number: String(row.room_number),
      current_status: String(row.current_status),
      occupancy_booking_id:
        row.occupancy_booking_id === null ? null : String(row.occupancy_booking_id),
      housekeeping_status: row.housekeeping_status as HousekeepingStatus,
      housekeeping_version: Number(row.housekeeping_version),
      housekeeping_updated_at: this.toIsoString(row.housekeeping_updated_at as Date | string),
    };
  }

  private mapHousekeepingEvent(event: HousekeepingEventRow): HousekeepingMutationView {
    return {
      event_id: String(event.event_id),
      room_id: Number(event.room_id),
      from_status: event.from_status,
      to_status: event.to_status,
      housekeeping_status: event.to_status,
      from_version: Number(event.from_version),
      to_version: Number(event.to_version),
      housekeeping_version: Number(event.to_version),
      reason: event.reason,
      changed_by: String(event.changed_by),
      occurred_at: this.toIsoString(event.occurred_at),
    };
  }

  private mapAssignmentEvent(event: AssignmentEventRow): RoomReassignmentView {
    return {
      event_id: String(event.event_id),
      booking_id: String(event.booking_id),
      booking_detail_id: String(event.booking_detail_id),
      from_room_id: Number(event.from_room_id),
      to_room_id: Number(event.to_room_id),
      from_version: Number(event.from_version),
      to_version: Number(event.to_version),
      room_assignment_version: Number(event.to_version),
      reason: event.reason,
      changed_by: String(event.changed_by),
      occurred_at: this.toIsoString(event.occurred_at),
    };
  }

  private affectedRows(result: unknown): number {
    if (!Array.isArray(result)) return 0;
    if (typeof result[1] === 'number') return result[1];
    if (Array.isArray(result[0])) return result[0].length;
    return result.length;
  }

  private asBoolean(value: boolean | string | undefined): boolean {
    return value === true || value === 'true';
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private getBusinessDate(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.configService.get<string>('HOTEL_TIMEZONE', 'Asia/Bangkok'),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  async getSmartUpgradeRecommendations(): Promise<SmartUpgradeRecommendation[]> {
    const upcomingBookings = (await this.dataSource.query(
      `SELECT b.booking_id,
              c.full_name AS customer_name,
              to_char(b.check_in_date, 'YYYY-MM-DD') AS check_in_date,
              to_char(b.check_out_date, 'YYYY-MM-DD') AS check_out_date,
              b.guest_count,
              (b.check_out_date - b.check_in_date) AS nights,
              bd.room_id AS current_room_id,
              bd.room_assignment_version,
              r.room_number AS current_room_number,
              rt.type_id AS current_type_id,
              rt.name AS current_type_name,
              rt.base_price AS current_base_price
       FROM bookings b
       INNER JOIN customers c ON b.customer_id = c.customer_id
       INNER JOIN booking_details bd ON b.booking_id = bd.booking_id
       INNER JOIN rooms r ON bd.room_id = r.room_id
       INNER JOIN room_types rt ON r.type_id = rt.type_id
       WHERE b.status = 'Confirmed'
         AND b.check_in_date >= CURRENT_DATE
         AND b.check_in_date <= CURRENT_DATE + INTERVAL '60 days'
       ORDER BY b.check_in_date ASC
       LIMIT 40`,
    )) as Array<{
      booking_id: string;
      customer_name: string;
      check_in_date: string;
      check_out_date: string;
      guest_count: number;
      nights: number;
      current_room_id: number;
      room_assignment_version: number;
      current_room_number: string;
      current_type_id: number;
      current_type_name: string;
      current_base_price: number;
    }>;

    if (!upcomingBookings.length) return [];

    const recommendations: SmartUpgradeRecommendation[] = [];
    const usedTargetRoomIds = new Set<number>();

    for (const item of upcomingBookings) {
      const candidateRooms = (await this.dataSource.query(
        `SELECT r.room_id,
                r.room_number,
                rt.type_id,
                rt.name AS type_name,
                rt.base_price
         FROM rooms r
         INNER JOIN room_types rt ON r.type_id = rt.type_id
         WHERE rt.base_price > $1
           AND rt.capacity >= $2
           AND r.current_status <> 'Maintenance'
           AND r.room_id NOT IN (
             SELECT bd.room_id
             FROM booking_details bd
             INNER JOIN bookings b ON bd.booking_id = b.booking_id
             WHERE b.status IN ('Confirmed', 'CheckedIn')
               AND b.check_in_date < $4::date
               AND b.check_out_date > $3::date
           )
         ORDER BY rt.base_price ASC, r.room_number ASC
         LIMIT 5`,
        [
          Number(item.current_base_price),
          Number(item.guest_count),
          item.check_in_date,
          item.check_out_date,
        ],
      )) as Array<{
        room_id: number;
        room_number: string;
        type_id: number;
        type_name: string;
        base_price: number;
      }>;

      const availableRoom = candidateRooms.find((r) => !usedTargetRoomIds.has(Number(r.room_id)));
      if (availableRoom) {
        usedTargetRoomIds.add(Number(availableRoom.room_id));
        const delta = (Number(availableRoom.base_price) - Number(item.current_base_price)) * Number(item.nights);
        recommendations.push({
          booking_id: item.booking_id,
          customer_name: item.customer_name,
          check_in_date: item.check_in_date,
          check_out_date: item.check_out_date,
          guest_count: Number(item.guest_count),
          nights: Number(item.nights),
          expected_assignment_version: Number(item.room_assignment_version),
          current_room: {
            room_id: Number(item.current_room_id),
            room_number: item.current_room_number,
            type_id: Number(item.current_type_id),
            type_name: item.current_type_name,
            base_price: Number(item.current_base_price),
          },
          recommended_room: {
            room_id: Number(availableRoom.room_id),
            room_number: availableRoom.room_number,
            type_id: Number(availableRoom.type_id),
            type_name: availableRoom.type_name,
            base_price: Number(availableRoom.base_price),
          },
          upgrade_delta_value: delta,
          occupancy_boost_reason: `Giải phóng phòng ${item.current_type_name} để đón lượt đặt mới mùa cao điểm và nâng tầm trải nghiệm phòng lên ${availableRoom.type_name}`,
          confidence_score: 0.94,
        });
      }

      if (recommendations.length >= 10) break;
    }

    return recommendations;
  }

  async executeUpgrade(
    dto: ExecuteUpgradeDto,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<RoomReassignmentView> {
    return this.reassignRoom(
      dto.booking_id,
      {
        target_room_id: dto.target_room_id,
        expected_assignment_version: dto.expected_assignment_version,
        reason: dto.reason,
        is_upgrade: true,
      },
      actorId,
      idempotencyKey,
    );
  }

  private rethrowWriteError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    const code = getPostgresErrorCode(error);
    if (['23505', '23514', '40001', '55000', 'P0001'].includes(code ?? '')) {
      throw new ConflictException(
        'Dữ liệu vận hành đã thay đổi hoặc vi phạm quy tắc phòng. Hãy tải lại và thử lại.',
      );
    }
    throw error;
  }
}


