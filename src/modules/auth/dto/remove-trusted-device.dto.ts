import { IsString } from 'class-validator';

export class RemoveTrustedDeviceDto {
  @IsString()
  deviceId: string;
}
