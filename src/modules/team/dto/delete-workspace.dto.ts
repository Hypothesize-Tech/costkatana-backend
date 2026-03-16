import { IsString, IsNotEmpty, Equals } from 'class-validator';

export class DeleteWorkspaceDto {
  @Equals('DELETE', {
    message: 'Type DELETE to confirm',
  })
  confirmation: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
