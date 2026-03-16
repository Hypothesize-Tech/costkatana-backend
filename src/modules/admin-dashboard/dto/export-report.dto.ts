import { IsOptional, IsArray, IsIn, IsEmail } from 'class-validator';
import { DateRangeQueryDto } from './date-range-query.dto';

export class GenerateUserActivityReportDto extends DateRangeQueryDto {}

export class GenerateCostAnalysisReportDto extends DateRangeQueryDto {}

export class GeneratePerformanceReportDto extends DateRangeQueryDto {}

export class ScheduleReportDto {
  @IsIn(['user-activity', 'cost-analysis', 'performance'])
  reportType: string;

  @IsIn(['daily', 'weekly', 'monthly'])
  frequency: 'daily' | 'weekly' | 'monthly';

  @IsArray()
  @IsEmail({}, { each: true })
  recipients: string[];

  @IsOptional()
  config?: {
    startDate?: Date;
    endDate?: Date;
  } = {};
}

export class SendReportDto {
  @IsIn(['user-activity', 'cost-analysis', 'performance'])
  reportType: string;

  @IsArray()
  @IsEmail({}, { each: true })
  recipients: string[];
}

export class ScheduledReportsQueryDto {}
