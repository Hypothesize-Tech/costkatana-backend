import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class TrackUsageDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  requests?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  logs?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;
}
