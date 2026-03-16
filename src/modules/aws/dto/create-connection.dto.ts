import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';

export class CreateConnectionDto {
  @IsString()
  @IsNotEmpty()
  connectionName: string;

  @IsString()
  @IsNotEmpty()
  roleArn: string;

  @IsEnum(['production', 'staging', 'development'])
  environment: 'production' | 'staging' | 'development';

  @IsEnum(['read-only', 'read-write', 'custom'])
  permissionMode: 'read-only' | 'read-write' | 'custom';

  @IsArray()
  @IsOptional()
  allowedRegions?: string[];

  @IsArray()
  @IsOptional()
  selectedPermissions?: Array<{
    service: string;
    actions: string[];
    regions: string[];
  }>;

  @IsString()
  @IsOptional()
  externalId?: string;

  @IsBoolean()
  @IsOptional()
  simulationMode?: boolean;
}
