import {
  IsString,
  IsObject,
  IsInt,
  Min,
  Max,
  Length,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class WizardStateDto {
  @IsInt()
  @Min(1, { message: 'Wizard step must be between 1 and 5' })
  @Max(5, { message: 'Wizard step must be between 1 and 5' })
  step: number;

  @IsOptional()
  @IsObject()
  responses?: Record<string, any>;
}

/**
 * DTO for continuing project creation wizard (POST /api/agent/wizard/continue)
 * Matches Express validation: body('response'), body('wizardState')
 */
export class ContinueWizardDto {
  @IsString()
  @Length(1, 1000, {
    message: 'Response must be between 1 and 1000 characters',
  })
  response: string;

  @IsObject()
  @ValidateNested()
  @Type(() => WizardStateDto)
  wizardState: WizardStateDto;
}
