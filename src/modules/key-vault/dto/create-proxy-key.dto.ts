import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsMongoId,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsDateString,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

const PERMISSIONS = ['read', 'write', 'admin'] as const;
export type ProxyKeyPermission = (typeof PERMISSIONS)[number];

export class CreateProxyKeyDto {
  @IsString()
  @MinLength(1, { message: 'Name is required' })
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(1, { message: 'Provider key ID is required' })
  @IsMongoId()
  providerKeyId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @IsMongoId()
  projectId?: string;

  @IsOptional()
  @IsArray()
  @IsIn(PERMISSIONS, { each: true })
  permissions?: ProxyKeyPermission[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  budgetLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  dailyBudgetLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  monthlyBudgetLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  @Type(() => Number)
  rateLimit?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedIPs?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
