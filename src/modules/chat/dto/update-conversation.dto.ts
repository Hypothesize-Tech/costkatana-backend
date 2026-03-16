import { IsString, IsBoolean, MaxLength, IsOptional } from 'class-validator';

export class RenameConversationDto {
  @IsString()
  @MaxLength(256)
  title: string;
}

export class ArchiveConversationDto {
  @IsBoolean()
  archived: boolean;
}

export class PinConversationDto {
  @IsBoolean()
  pinned: boolean;
}

export class UpdateMessageViewTypeDto {
  @IsString()
  viewType:
    | 'table'
    | 'json'
    | 'schema'
    | 'stats'
    | 'chart'
    | 'text'
    | 'error'
    | 'empty'
    | 'explain';
}

export class UpdateVercelContextDto {
  @IsString()
  @IsOptional()
  connectionId?: string;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  projectName?: string;
}
