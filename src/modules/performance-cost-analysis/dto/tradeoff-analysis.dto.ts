import {
  IsOptional,
  IsArray,
  IsString,
  IsObject,
  IsDateString,
} from 'class-validator';

export class PriorityWeightsDto {
  cost?: number;
  latency?: number;
  quality?: number;
}

export class TradeoffAnalysisBodyDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  services?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  models?: string[];

  @IsOptional()
  @IsObject()
  priorityWeights?: PriorityWeightsDto;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
