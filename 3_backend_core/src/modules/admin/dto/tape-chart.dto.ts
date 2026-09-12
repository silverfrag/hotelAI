import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { AdminBookingStatus } from './admin-bookings.dto';

export class TapeChartQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate phải có định dạng YYYY-MM-DD.',
  })
  startDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(30)
  days = 14;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomTypeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  floor?: number;
}

export interface TapeChartDayColumn {
  date: string;
  dayOfWeek: string;
  isToday: boolean;
  isWeekend: boolean;
}

export interface TapeChartBookingSlot {
  bookingId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  status: AdminBookingStatus;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  appliedPrice: number;
  isStart: boolean;
  isEnd: boolean;
  isSpan: boolean;
  roomAssignmentVersion: number;
  canCheckIn: boolean;
  canCheckOut: boolean;
}

export interface TapeChartRoomRow {
  roomId: number;
  roomNumber: string;
  floor: number;
  roomTypeId: number;
  roomTypeName: string;
  basePrice: number;
  currentStatus: 'Available' | 'Occupied' | 'Maintenance';
  housekeepingStatus: 'Ready' | 'Dirty' | 'Cleaning' | 'Inspected' | 'Maintenance';
  housekeepingVersion: number;
  occupancyBookingId: string | null;
  slots: Record<string, TapeChartBookingSlot | null>;
}

export interface TapeChartMetrics {
  totalRooms: number;
  occupiedRoomsToday: number;
  occupancyRateToday: number;
  arrivalsToday: number;
  departuresToday: number;
  readyRooms: number;
  dirtyRooms: number;
  cleaningRooms: number;
  maintenanceRooms: number;
}

export interface TapeChartView {
  businessDate: string;
  startDate: string;
  endDate: string;
  days: number;
  timeline: TapeChartDayColumn[];
  metrics: TapeChartMetrics;
  rooms: TapeChartRoomRow[];
}
