import {
  IsString,
  IsOptional,
  IsObject,
  MaxLength,
  IsBoolean,
} from 'class-validator';

export class CreateMongodbConnectionDto {
  @IsString()
  @MaxLength(100)
  alias: string;

  @IsString()
  connectionString: string;

  @IsString()
  database: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
