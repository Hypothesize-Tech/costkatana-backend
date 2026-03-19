import {
  IsString,
  IsOptional,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug: string;

  @IsOptional()
  securitySettings?: {
    killSwitchActive?: boolean;
    readOnlyMode?: boolean;
    requireMfaForSensitiveActions?: boolean;
  };
}
