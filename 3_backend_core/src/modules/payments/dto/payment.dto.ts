import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum PaymentMethod {
  Cash = 'Cash',
  BankTransfer = 'BankTransfer',
  CardTerminal = 'CardTerminal',
}

export enum PaymentTransactionType {
  Payment = 'Payment',
  Refund = 'Refund',
}

const trimmedOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const result = value.trim();
  return result.length ? result : undefined;
};

export class RecordPaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999.99)
  amount: number;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,100}$/)
  idempotency_key: string;

  @Transform(trimmedOptional)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  external_reference?: string;

  @Transform(trimmedOptional)
  @IsOptional()
  @IsString()
  @MaxLength(250)
  note?: string;
}

export class RefundPaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999.99)
  amount: number;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,100}$/)
  idempotency_key: string;

  @Transform(trimmedOptional)
  @IsOptional()
  @IsString()
  @MaxLength(250)
  note?: string;
}

export class AdminPaymentsQueryDto {
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
  @IsEnum(PaymentTransactionType)
  transaction_type?: PaymentTransactionType;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @Transform(trimmedOptional)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;
}
