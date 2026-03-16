import { IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class ExecuteNotebookDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  async?: boolean = false;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skip_cache?: boolean = false;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enable_debug?: boolean = false;
}
