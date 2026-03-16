import { IsOptional, IsString, IsBoolean } from 'class-validator';

/**
 * DTO for starting project creation wizard (POST /api/agent/wizard/start)
 * Matches Express validation: body('projectType'), body('quickStart')
 */
export class StartWizardDto {
  @IsOptional()
  @IsString()
  projectType?: string;

  @IsOptional()
  @IsBoolean()
  quickStart?: boolean;
}
