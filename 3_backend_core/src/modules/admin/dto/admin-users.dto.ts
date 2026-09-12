import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export enum AdminUserRole {
  Customer = 'customer',
  Admin = 'admin',
}

export enum AdminUserStatus {
  Active = 'Active',
  Suspended = 'Suspended',
}

export enum AdminUserListStatus {
  Active = 'Active',
  Suspended = 'Suspended',
  Deactivated = 'Deactivated',
}

export class AdminUsersQueryDto {
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

  @IsOptional()
  @IsEnum(AdminUserRole)
  role?: AdminUserRole;

  @IsOptional()
  @IsEnum(AdminUserListStatus)
  status?: AdminUserListStatus;

  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsEnum(AdminUserRole)
  role?: AdminUserRole;

  @IsOptional()
  @IsEnum(AdminUserStatus)
  account_status?: AdminUserStatus;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expected_version: number;
}

export class AdminUserAuditsQueryDto {
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
