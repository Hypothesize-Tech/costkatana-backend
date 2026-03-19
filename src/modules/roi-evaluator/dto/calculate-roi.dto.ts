import { IsString, IsNumber, IsArray, IsOptional, IsEnum, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export const COMPANY_SIZE_OPTIONS = ['1-50', '51-200', '201-1000', '1000+'] as const;
export type CompanySize = (typeof COMPANY_SIZE_OPTIONS)[number];

export const TIME_HORIZON_OPTIONS = [12, 24, 36] as const;
export type TimeHorizon = (typeof TIME_HORIZON_OPTIONS)[number];

export class UseCaseDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  currentHeadcount: number;

  @IsNumber()
  @Min(0)
  currentCostPerMonth: number;

  @IsNumber()
  @Min(0)
  @Max(168)
  hoursPerWeekSpent: number;
}

export class CalculateRoiDto {
  @IsString()
  industry: string;

  @IsEnum(COMPANY_SIZE_OPTIONS)
  companySize: CompanySize;

  @IsNumber()
  @Min(0)
  annualRevenue: number;

  @IsArray()
  @Type(() => UseCaseDto)
  useCases: UseCaseDto[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  currentAISpend?: number;

  @IsNumber()
  @Min(0)
  implementationBudget: number;

  @IsOptional()
  @IsIn([12, 24, 36])
  timeHorizon?: TimeHorizon;
}
