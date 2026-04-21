import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsArray,
  IsObject,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  ValidateNested,
  IsMongoId,
  ValidateBy,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

// Custom validator for string | number | boolean union type
function IsStringOrNumberOrBoolean(validationOptions?: any) {
  return ValidateBy(
    {
      name: 'isStringOrNumberOrBoolean',
      validator: {
        validate: (value: any): boolean => {
          return (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          );
        },
        defaultMessage: () => 'Value must be a string, number, or boolean',
      },
    },
    validationOptions,
  );
}

export class AttachmentDto {
  @IsString()
  name: string;

  @IsString()
  type: string; // 'file' | 'url'

  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  mimeType?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  size?: number;

  @IsString()
  @IsOptional()
  fileId?: string;

  @IsString()
  @IsOptional()
  fileName?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  fileSize?: number;

  @IsString()
  @IsOptional()
  fileType?: string;
}

export class ThinkingOptionsDto {
  @IsBoolean()
  enabled: boolean;

  @IsEnum(['low', 'medium', 'high', 'max'])
  @IsOptional()
  effort?: 'low' | 'medium' | 'high' | 'max';

  @IsInt()
  @Min(1024)
  @Max(64000)
  @IsOptional()
  budgetTokens?: number;
}

export class SelectionResponseDto {
  @IsString()
  parameterName: string;

  @IsStringOrNumberOrBoolean()
  value: string | number | boolean;

  @IsString()
  pendingAction: string;

  @IsObject()
  collectedParams: Record<string, unknown>;

  @IsString()
  @IsOptional()
  integration?: string;
}

export class SendMessageDto {
  @IsString()
  @IsOptional()
  message?: string;

  @IsString()
  @IsOptional()
  originalMessage?: string;

  @IsString()
  modelId: string;

  @IsMongoId()
  @IsOptional()
  conversationId?: string;

  @IsNumber()
  @Min(0)
  @Max(2)
  @IsOptional()
  temperature?: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  @IsOptional()
  maxTokens?: number;

  /** Overrides the default Bedrock/Claude system prompt for this message. */
  @IsString()
  @IsOptional()
  @MaxLength(200000)
  system?: string;

  /** When false, no system block is sent (custom `system` is ignored). */
  @IsBoolean()
  @IsOptional()
  useSystemPrompt?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  @IsOptional()
  attachments?: AttachmentDto[];

  @IsMongoId()
  @IsOptional()
  templateId?: string;

  @IsObject()
  @IsOptional()
  templateVariables?: Record<string, any>;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  documentIds?: string[];

  /**
   * Enables Claude's native citations feature. When true (default when
   * `documentIds` or `attachments` are present), attached/retrieved documents
   * are passed as `document` content blocks with `citations.enabled: true`
   * and the response carries a structured `citations[]` array.
   */
  @IsBoolean()
  @IsOptional()
  useCitations?: boolean;

  @IsBoolean()
  @IsOptional()
  useWebSearch?: boolean;

  @IsEnum(['fastest', 'cheapest', 'balanced'])
  @IsOptional()
  chatMode?: 'fastest' | 'cheapest' | 'balanced';

  @IsBoolean()
  @IsOptional()
  useMultiAgent?: boolean;

  @ValidateNested()
  @Type(() => SelectionResponseDto)
  @IsOptional()
  selectionResponse?: SelectionResponseDto;

  @IsObject()
  @IsOptional()
  githubContext?: Record<string, any>;

  @IsObject()
  @IsOptional()
  vercelContext?: Record<string, any>;

  @IsObject()
  @IsOptional()
  mongodbContext?: Record<string, any>;

  @IsObject()
  @IsOptional()
  slackContext?: Record<string, any>;

  @IsObject()
  @IsOptional()
  discordContext?: Record<string, any>;

  @IsObject()
  @IsOptional()
  jiraContext?: Record<string, any>;

  @IsObject()
  @IsOptional()
  linearContext?: Record<string, any>;

  @IsObject()
  @IsOptional()
  awsContext?: Record<string, any>;

  @IsObject()
  @IsOptional()
  googleContext?: Record<string, any>;

  @IsBoolean()
  @IsOptional()
  stream?: boolean;

  @IsBoolean()
  @IsOptional()
  useCortexStreaming?: boolean;

  @ValidateNested()
  @Type(() => ThinkingOptionsDto)
  @IsOptional()
  thinking?: ThinkingOptionsDto;
}
