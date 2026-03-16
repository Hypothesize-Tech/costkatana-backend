import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  modelId?: string;
}
