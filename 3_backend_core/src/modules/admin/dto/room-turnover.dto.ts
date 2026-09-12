import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
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
  confidence_score: number;
};

