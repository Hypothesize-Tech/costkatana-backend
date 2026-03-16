import { IsEnum } from 'class-validator';

export class UpdateMemberRoleDto {
  @IsEnum(['admin', 'developer', 'viewer'], {
    message: 'Role must be admin, developer, or viewer',
  })
  role: 'admin' | 'developer' | 'viewer';
}
