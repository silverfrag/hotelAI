import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

const normalizeRoomNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export enum RoomStatus {
  Available = 'Available',
  Occupied = 'Occupied',
  Maintenance = 'Maintenance',
}

export class CreatePhysicalRoomDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  type_id: number;

  @Transform(normalizeRoomNumber)
  @IsString()
  @IsNotEmpty()
  @Length(1, 10)
  @Matches(/^[A-Za-z0-9-]+$/)
  room_number: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(RoomStatus)
  current_status?: RoomStatus;
}

export class UpdatePhysicalRoomDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  type_id?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(normalizeRoomNumber)
  @IsString()
  @IsNotEmpty()
  @Length(1, 10)
  @Matches(/^[A-Za-z0-9-]+$/)
  room_number?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(RoomStatus)
  current_status?: RoomStatus;
}
