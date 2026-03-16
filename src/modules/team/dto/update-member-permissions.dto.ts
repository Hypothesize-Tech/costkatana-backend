import { IsOptional, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PermissionsDto {
  @IsOptional()
  @IsBoolean()
  canManageBilling?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageTeam?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageProjects?: boolean;

  @IsOptional()
  @IsBoolean()
  canViewAnalytics?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageApiKeys?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageIntegrations?: boolean;

  @IsOptional()
  @IsBoolean()
  canExportData?: boolean;
}

export class UpdateMemberPermissionsDto {
  @ValidateNested()
  @Type(() => PermissionsDto)
  permissions: PermissionsDto;
}
