import {
  IsString,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class MessageContextDto {
  @IsString()
  role: string;

  @IsString()
  content: string;
}

export class ResolveMessageTemplateDto {
  @IsString()
  templateId: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageContextDto)
  context?: MessageContextDto[];
}
