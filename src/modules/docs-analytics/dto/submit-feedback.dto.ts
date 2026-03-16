import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SubmitFeedbackDto {
  @IsString()
  pageId: string;

  @IsString()
  pagePath: string;

  @IsString()
  @IsIn(['bug', 'improvement', 'question', 'other'])
  feedbackType: 'bug' | 'improvement' | 'question' | 'other';

  @IsString()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  sessionId: string;
}
