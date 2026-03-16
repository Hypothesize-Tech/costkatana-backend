import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  MaxLength,
} from 'class-validator';

export class CalculateCostsDto {
  @IsString()
  @MaxLength(100)
  provider: string;

  @IsString()
  @MaxLength(200)
  model: string;

  @IsNumber()
  @Min(1)
  inputTokens: number;

  @IsNumber()
  @Min(1)
  outputTokens: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  requestsPerDay?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  daysPerMonth?: number = 30;
}
