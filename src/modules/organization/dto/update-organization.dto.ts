import {
  IsString,
  IsOptional,
  IsBoolean,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @IsOptional()
  securitySettings?: {
    killSwitchActive?: boolean;
    readOnlyMode?: boolean;
    requireMfaForSensitiveActions?: boolean;
  };

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
