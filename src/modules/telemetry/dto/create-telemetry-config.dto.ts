import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsNumber,
  Min,
  Max,
  IsObject,
} from 'class-validator';

export class CreateTelemetryConfigDto {
  @IsEnum(['otlp-http', 'otlp-grpc', 'tempo', 'jaeger', 'prometheus', 'custom'])
  @IsNotEmpty()
  endpointType:
    | 'otlp-http'
    | 'otlp-grpc'
    | 'tempo'
    | 'jaeger'
    | 'prometheus'
    | 'custom';

  @IsUrl({}, { message: 'Endpoint must be a valid URL' })
  @IsNotEmpty()
  endpoint: string;

  @IsOptional()
  @IsEnum(['none', 'bearer', 'basic', 'api-key', 'custom-header'])
  authType?: 'none' | 'bearer' | 'basic' | 'api-key' | 'custom-header';

  @IsOptional()
  @IsString()
  authToken?: string;

  @IsOptional()
  @IsString()
  authHeader?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1440)
  syncIntervalMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1440)
  queryTimeRangeMinutes?: number;

  @IsOptional()
  @IsObject()
  queryFilters?: {
    serviceName?: string;
    environment?: string;
    tags?: Record<string, string>;
  };
}
