import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class AddTrustedDeviceDto {
  @IsString()
  deviceName: string;

  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}
