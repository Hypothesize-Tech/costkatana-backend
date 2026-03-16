import { IsOptional, IsString, IsBoolean, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

export class AdminDiscountQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : value === 'true',
  )
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['percentage', 'fixed'])
  type?: 'percentage' | 'fixed';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['free', 'plus', 'pro', 'enterprise'])
  plan?: 'free' | 'plus' | 'pro' | 'enterprise';

  @IsOptional()
  @Transform(({ value }) => Math.max(1, parseInt(value, 10) || 1))
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) =>
    Math.min(100, Math.max(1, parseInt(value, 10) || 20)),
  )
  limit?: number = 20;
}
