import {
  IsOptional,
  IsObject,
  IsString,
  IsNumber,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CodeContextDto {
  @IsString()
  filePath: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  language?: string;
}

class TokensDto {
  @IsNumber()
  input: number;

  @IsNumber()
  output: number;
}

class AiInteractionDto {
  @IsString()
  model: string;

  @IsString()
  prompt: string;

  @IsString()
  response: string;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => TokensDto)
  tokens?: TokensDto;

  @IsOptional()
  @IsNumber()
  cost?: number;
}

class UserActionDto {
  @IsString()
  action: string;

  @IsOptional()
  details?: unknown;
}

export class AddSnapshotDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CodeContextDto)
  codeContext?: CodeContextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AiInteractionDto)
  aiInteraction?: AiInteractionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UserActionDto)
  userAction?: UserActionDto;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  captureSystemMetrics?: boolean;
}
