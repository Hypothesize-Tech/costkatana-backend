import { IsOptional, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class RecentQueryDto {
  @IsString()
  collection: string;

  query: any;

  @IsOptional()
  timestamp?: Date;
}

export class UpdateMongoDBContextDto {
  @IsOptional()
  @IsString()
  connectionId?: string;

  @IsOptional()
  @IsString()
  activeDatabase?: string;

  @IsOptional()
  @IsString()
  activeCollection?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecentQueryDto)
  recentQueries?: RecentQueryDto[];
}
