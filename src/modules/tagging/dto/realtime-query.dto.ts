import { IsOptional, IsString } from 'class-validator';

export class RealtimeQueryDto {
  @IsOptional()
  @IsString()
  tags?: string;
}
