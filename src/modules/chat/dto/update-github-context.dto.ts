import { IsString, IsOptional, IsNumber } from 'class-validator';

export class UpdateGitHubContextDto {
  @IsOptional()
  @IsString()
  connectionId?: string;

  @IsOptional()
  @IsNumber()
  repositoryId?: number;

  @IsOptional()
  @IsString()
  repositoryName?: string;

  @IsOptional()
  @IsString()
  repositoryFullName?: string;

  @IsOptional()
  @IsString()
  integrationId?: string;

  @IsOptional()
  @IsString()
  branchName?: string;
}
