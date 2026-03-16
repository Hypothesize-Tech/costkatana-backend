import {
  IsOptional,
  IsString,
  IsUrl,
  IsNumber,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';

export class UpdateTelemetryConfigDto {
  @IsOptional()
  @IsUrl({}, { message: 'Endpoint must be a valid URL' })
  endpoint?: string;

  @IsOptional()
  @IsString()
  authToken?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1440)
  syncIntervalMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  syncEnabled?: boolean;
}
