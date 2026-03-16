import {
  IsArray,
  IsString,
  IsNotEmpty,
  ArrayNotEmpty,
  IsOptional,
} from 'class-validator';

export class StopStartInstancesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  instanceIds: string[];

  @IsString()
  @IsOptional()
  region?: string;

  @IsString()
  @IsNotEmpty()
  connectionId: string;
}
