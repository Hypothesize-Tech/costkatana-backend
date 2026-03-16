import { IsMongoId } from 'class-validator';

export class SwitchWorkspaceDto {
  @IsMongoId()
  workspaceId: string;
}
