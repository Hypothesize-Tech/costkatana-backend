import {
  IsString,
  IsArray,
  IsOptional,
  IsDateString,
  MinLength,
  MaxLength,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @IsArray()
  @IsIn(['read', 'write', 'admin'], { each: true })
  permissions: ('read' | 'write' | 'admin')[];

  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    // If it's already a datetime string, return as is
    if (value.includes('T') || value.includes('Z')) {
      return value;
    }
    // If it's a date string (YYYY-MM-DD), convert to end of day datetime
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `${value}T23:59:59.999Z`;
    }
    return value;
  })
  @IsDateString()
  expiresAt?: string;
}

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsIn(['read', 'write', 'admin'], { each: true })
  permissions?: ('read' | 'write' | 'admin')[];

  @IsOptional()
  @Transform(({ value }) => value || undefined)
  expiresAt?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;
}
