import { IsOptional, IsIn } from 'class-validator';

export class ApprovalsQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'expired'])
  status?: 'pending' | 'approved' | 'rejected' | 'expired';
}
