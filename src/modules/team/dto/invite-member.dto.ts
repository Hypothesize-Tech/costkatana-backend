import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsArray,
  IsMongoId,
} from 'class-validator';

export class InviteMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(['admin', 'developer', 'viewer'], {
    message: 'Role must be admin, developer, or viewer',
  })
  role: 'admin' | 'developer' | 'viewer';

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  projectIds?: string[];
}
