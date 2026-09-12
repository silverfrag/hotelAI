import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const nullableTrimmed = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const result = value.trim();
  return result.length ? result : null;
};

export class UpdateProfileDto {
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  full_name?: string;

  @Transform(nullableTrimmed)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[0-9+().\s-]{6,20}$/, { message: 'Số điện thoại không hợp lệ.' })
  phone?: string | null;

  @Transform(nullableTrimmed)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nationality?: string | null;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expected_version: number;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  current_password: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  new_password: string;
}

export class DeactivateAccountDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
