import { IsIn, IsOptional, IsString } from 'class-validator';

export class TrackPageViewDto {
  @IsString()
  pageId: string;

  @IsString()
  pagePath: string;

  @IsString()
  sessionId: string;

  @IsOptional()
  @IsString()
  referrer?: string;

  @IsOptional()
  @IsString()
  @IsIn(['desktop', 'tablet', 'mobile'])
  deviceType?: 'desktop' | 'tablet' | 'mobile';
}
