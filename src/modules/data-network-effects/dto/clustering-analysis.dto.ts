import { IsOptional, IsString, IsDateString, IsNumber } from 'class-validator';

export class ClusteringAnalysisDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsNumber()
  numClusters?: number;
}
