import { IsString, IsOptional, MinLength, IsMongoId } from 'class-validator';

export class CreateTagHierarchyDto {
  @IsString()
  @MinLength(1, { message: 'Tag name is required' })
  name: string;

  @IsOptional()
  @IsMongoId()
  parent?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
