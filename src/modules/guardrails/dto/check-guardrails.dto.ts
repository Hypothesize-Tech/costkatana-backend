import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CheckGuardrailsDto {
  @IsEnum(['token', 'request', 'log'])
  requestType: 'token' | 'request' | 'log';

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  amount?: number;

  @IsOptional()
  @IsString()
  modelId?: string;
}
