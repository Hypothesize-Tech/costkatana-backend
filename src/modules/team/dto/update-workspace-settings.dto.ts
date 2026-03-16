import {
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

export class WorkspaceSettingsDto {
  @IsOptional()
  @IsBoolean()
  allowMemberInvites?: boolean;

  @IsOptional()
  @IsEnum(['all', 'assigned'])
  defaultProjectAccess?: 'all' | 'assigned';

  @IsOptional()
  @IsBoolean()
  requireEmailVerification?: boolean;
}

export class UpdateWorkspaceSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkspaceSettingsDto)
  settings?: WorkspaceSettingsDto;
}
