import { IsArray, IsMongoId } from 'class-validator';

export class UpdateMemberProjectsDto {
  @IsArray()
  @IsMongoId({ each: true })
  projectIds: string[];
}
