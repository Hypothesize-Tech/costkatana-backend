import { IsString, IsIn } from 'class-validator';

export class NavigateModeDto {
  @IsString()
  @IsIn(['SCOPE', 'CLARIFY', 'PLAN', 'BUILD', 'VERIFY', 'DONE'])
  mode: 'SCOPE' | 'CLARIFY' | 'PLAN' | 'BUILD' | 'VERIFY' | 'DONE';
}
