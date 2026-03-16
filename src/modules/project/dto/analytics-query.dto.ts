import { IsOptional, IsIn } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsIn(['monthly', 'quarterly', 'yearly'])
  period?: 'monthly' | 'quarterly' | 'yearly';
}
