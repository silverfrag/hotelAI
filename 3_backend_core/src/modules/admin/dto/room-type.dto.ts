import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsString, Length, Max, Min, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateRoomTypeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  name: string;

  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false })
  @Min(0.01)
  @Max(99_999_999.99)
  base_price: number;

  @IsInt()
  @Min(1)
  @Max(1_000)
  capacity: number;
}

export class UpdateRoomTypeDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false })
  @Min(0.01)
  @Max(99_999_999.99)
  base_price?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(1_000)
  capacity?: number;
}
