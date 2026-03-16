import { IsEnum, IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class KillSwitchDto {
  @IsEnum(['global', 'customer', 'service', 'connection'])
  scope: 'global' | 'customer' | 'service' | 'connection';

  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
