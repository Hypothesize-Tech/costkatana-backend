import { IsBoolean } from 'class-validator';

export class UpdateProxyKeyStatusDto {
  @IsBoolean()
  isActive: boolean;
}
