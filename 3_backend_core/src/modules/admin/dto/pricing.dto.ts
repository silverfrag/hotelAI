import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdatePricingSettingDto {
  @IsBoolean()
  ai_enabled: boolean;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expected_version: number;
}

export class PricingLogsQueryDto {
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

export class UpdateAiShadowSettingDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expected_version: number;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  change_reason: string;

  @IsOptional()
  @IsBoolean()
  shadow_enabled?: boolean;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  champion_model_version?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  champion_training_run_id?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  champion_feature_contract_version?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  challenger_model_version?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  challenger_training_run_id?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  challenger_feature_contract_version?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.1)
  @Max(3)
  guardrail_min_multiplier?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.1)
  @Max(5)
  guardrail_max_multiplier?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  guardrail_max_change_ratio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  minimum_confirmed_exposures?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  minimum_conversions?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  minimum_non_conversions?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3_650)
  minimum_shadow_days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  minimum_inference_coverage_ratio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  maximum_inference_error_ratio?: number;
}

export class PauseAiShadowDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expected_version: number;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  change_reason: string;
}

export class RollbackAiShadowDto extends PauseAiShadowDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  target_version: number;
}
