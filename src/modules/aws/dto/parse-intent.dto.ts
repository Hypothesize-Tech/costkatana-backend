import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ParseIntentDto {
  @IsString()
  @IsNotEmpty()
  request: string;

  @IsString()
  @IsOptional()
  connectionId?: string;
}
