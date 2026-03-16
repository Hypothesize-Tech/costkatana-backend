import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

export class TestTelemetryEndpointDto {
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
  @IsString()
  authToken?: string;
}
