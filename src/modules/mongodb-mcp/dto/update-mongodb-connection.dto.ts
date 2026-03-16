import {
  IsString,
  IsOptional,
  IsObject,
  MaxLength,
  IsBoolean,
} from 'class-validator';

export class UpdateMongodbConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  alias?: string;

  @IsOptional()
  @IsString()
  connectionString?: string;

  @IsOptional()
  @IsString()
  database?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
