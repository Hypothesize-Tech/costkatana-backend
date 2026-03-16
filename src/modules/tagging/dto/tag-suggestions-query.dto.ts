import { IsOptional, IsString, IsMongoId } from 'class-validator';

export class TagSuggestionsQueryDto {
  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsMongoId()
  projectId?: string;
}
