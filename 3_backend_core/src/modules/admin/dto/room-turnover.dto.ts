import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trimText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export enum HousekeepingStatus {
  Ready = 'Ready',
  Dirty = 'Dirty',
  Cleaning = 'Cleaning',
}

export class HousekeepingQueueQueryDto {
  @IsOptional()
  @IsEnum(HousekeepingStatus)
  status?: HousekeepingStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  offset = 0;
}

export class UpdateHousekeepingStatusDto {
  @IsEnum(HousekeepingStatus)
  target_status: HousekeepingStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expected_version: number;

  @Transform(trimText)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class ReassignRoomDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  target_room_id: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expected_assignment_version: number;

  @Transform(trimText)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsBoolean()
  is_upgrade?: boolean;
}

export class ExecuteUpgradeDto {
  @IsUUID('4')
  booking_id: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  target_room_id: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expected_assignment_version: number;

  @Transform(trimText)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export type SmartUpgradeRecommendation = {
  booking_id: string;
  customer_name: string;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  nights: number;
  expected_assignment_version: number;
  current_room: {
    room_id: number;
    room_number: string;
    type_id: number;
    type_name: string;
    base_price: number;
  };
  recommended_room: {
    room_id: number;
    room_number: string;
    type_id: number;
    type_name: string;
    base_price: number;
  };
  upgrade_delta_value: number;
  occupancy_boost_reason: string;
  confidence_score: number | null;
  recommendation_source: 'rule_based';
};

export class AllocationQueueQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  start_date?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  end_date?: string;
}

export class OptimizeBookingQueueDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  booking_ids?: string[];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  start_date?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  end_date?: string;

  @IsOptional()
  @IsBoolean()
  allow_upgrades?: boolean;
}

export type AdminAllocationQueueItem = {
  booking_id: string;
  customer_id: string;
  customer_name: string;
  loyalty_tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  status: string;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  guest_count: number;
  total_price: number;
  current_room_id: number;
  current_room_number: string;
  current_type_id: number;
  current_type_name: string;
  current_base_price: number;
  room_current_status: string;
  housekeeping_status: string;
  room_assignment_version: number;
  requires_ready_now: boolean;
  can_optimize: boolean;
};

export type AdminQueueOptimizationRecommendation = {
  booking_id: string;
  customer_name: string;
  loyalty_tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  check_in_date: string;
  check_out_date: string;
  nights: number;
  guest_count: number;
  total_price: number;
  expected_assignment_version: number;
  requires_ready_now: boolean;
  status: 'ASSIGNED' | 'REJECTED_NO_CAPACITY';
  changed: boolean;
  is_upgrade: boolean;
  upgrade_delta_value: number;
  current_room: {
    room_id: number;
    room_number: string;
    type_id: number;
    type_name: string;
    base_price: number;
  };
  recommended_room: {
    room_id: number;
    room_number: string;
    type_id: number;
    type_name: string;
    base_price: number;
  } | null;
  reason_vi: string;
};

export type AdminQueueOptimizationResult = {
  status: string;
  solver_time_ms: number;
  total_assigned_revenue: number;
  evaluated_bookings: number;
  changed_count: number;
  upgrade_count: number;
  unassigned_request_ids: string[];
  audit_notes: string[];
  window_start: string;
  window_end: string;
  existing_occupancy_count: number;
  provenance: string;
  recommendations: AdminQueueOptimizationRecommendation[];
};
