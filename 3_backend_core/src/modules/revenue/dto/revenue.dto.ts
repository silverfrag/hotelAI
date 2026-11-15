import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CustomScenarioDto {
  @IsString() scenario_id: string;
  @IsString() name_vi: string;
  @IsIn(['low', 'normal', 'high', 'surge']) demand_level: 'low' | 'normal' | 'high' | 'surge';
  @IsIn(['sunny_favorable', 'stormy_unfavorable']) weather: 'sunny_favorable' | 'stormy_unfavorable';
  @IsIn(['lower_undercut', 'par_neutral', 'higher_premium']) competitor_rate_position: 'lower_undercut' | 'par_neutral' | 'higher_premium';
  @IsNumber() @Min(0) serving_cost_per_night: number;
  @IsNumber() @Min(0) @Max(1) channel_commission_pct: number;
  @IsNumber() @Min(0) @Max(1) tax_rate: number;
  @IsNumber() @Min(0) @Max(1) service_charge_rate: number;
  @IsNumber() @Min(0) min_contribution_margin: number;
}

export class RevenueQuoteDto {
  @Type(() => Number) @IsInt() @Min(1) room_type_id: number;
  @IsOptional() @IsString() room_type_name?: string;
  @Type(() => Number) @IsNumber() @Min(1) base_price: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) declared_max_price?: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) check_in_date: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) check_out_date: string;
  @Type(() => Number) @IsInt() @Min(1) guest_count: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) rooms_available?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) rooms_total?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.5) @Max(3.0) ml_multiplier?: number;
  @IsOptional() @IsString() scenario_id?: string;
  @IsOptional() @IsString() coupon_code?: string;
  @IsOptional() @ValidateNested() @Type(() => CustomScenarioDto) custom_scenario?: CustomScenarioDto;
}

export class AllocationRequestItemDto {
  @IsString() request_id: string;
  @Type(() => Number) @IsInt() @Min(1) room_type_id: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) check_in_date: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) check_out_date: string;
  @Type(() => Number) @IsInt() @Min(1) guest_count: number;
  @IsOptional() @Type(() => Number) @IsNumber() revenue_value?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) vip_priority?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) requested_base_price?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) current_room_id?: number;
  @IsOptional() @IsBoolean() requires_ready_room?: boolean;
}

export class PhysicalRoomItemDto {
  @Type(() => Number) @IsInt() room_id: number;
  @IsString() room_number: string;
  @Type(() => Number) @IsInt() type_id: number;
  @Type(() => Number) @IsInt() @Min(1) capacity: number;
  @IsOptional() @IsString() current_status?: string;
  @IsOptional() @IsString() housekeeping_status?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) base_price?: number;
}

export class ExistingOccupancyItemDto {
  @Type(() => Number) @IsInt() room_id: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) check_in_date: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) check_out_date: string;
  @IsString() booking_id: string;
}

export class OptimizeAllocationDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => AllocationRequestItemDto) requests: AllocationRequestItemDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => PhysicalRoomItemDto) available_rooms: PhysicalRoomItemDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ExistingOccupancyItemDto) existing_occupancies?: ExistingOccupancyItemDto[];
  @IsOptional() @IsBoolean() allow_upgrades?: boolean;
}

export class OptimizeLiveAllocationDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => AllocationRequestItemDto) requests: AllocationRequestItemDto[];
  @IsOptional() @IsBoolean() allow_upgrades?: boolean;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) check_in_date?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) check_out_date?: string;
}

export class ScenarioRunDto {
  @IsString() scenario_id: string;
  @IsOptional() custom_params?: Record<string, any>;
}

export class MarketPricingDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) check_in_date: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) guest_count?: number;
  @IsOptional() @IsInt() @Min(1) room_type_id?: number;
  @IsOptional() @IsIn(['upscale_resort_standard']) room_segment?: string;
  @IsOptional() @IsNumber() @Min(10000) @Max(100000000) base_price?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) rooms_available?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10000) rooms_total?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000000) serving_cost?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(0.5) commission_pct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(0.3) tax_pct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000000) min_margin?: number;
  @IsOptional() @IsNumber() @Min(1000) @Max(100000000) floor_price?: number;
  @IsOptional() @IsNumber() @Min(1000) @Max(100000000) ceiling_price?: number;
}

export class LiveContextQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2_147_483_647) room_type_id: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) check_in_date: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) check_out_date: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) guest_count?: number;
}

export class PortfolioOptimizeDto {
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) start_date?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(14) horizon_days?: number;
  @IsOptional() @IsIn(['monsoon_low', 'standard', 'weekend_high', 'holiday_surge']) scenario_id?: 'monsoon_low' | 'standard' | 'weekend_high' | 'holiday_surge';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.2) @Max(3.5) price_elasticity?: number;
  @IsOptional() @IsBoolean() allow_cross_tier_upgrades?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(50_000_000) serving_cost_per_night?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(0.5) channel_commission_pct?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(0.3) tax_rate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(0.2) service_charge_rate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(50_000_000) min_contribution_margin?: number;
}

export class BanditSimulateDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) room_type_id?: number;
  @IsOptional() @IsIn(['monsoon_low', 'standard', 'weekend_high', 'holiday_surge']) scenario_id?: 'monsoon_low' | 'standard' | 'weekend_high' | 'holiday_surge';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.4) @Max(3.0) true_price_elasticity?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(1000) episodes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(999999) seed?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(50_000_000) serving_cost_per_night?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(0.5) channel_commission_pct?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(0.3) tax_rate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(0.2) service_charge_rate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(50_000_000) min_contribution_margin?: number;
}
