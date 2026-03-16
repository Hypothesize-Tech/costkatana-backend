import { IsString, IsNotEmpty } from 'class-validator';

export class ArchiveConversationDto {
  @IsString()
  @IsNotEmpty({ message: 'User ID is required' })
  userId: string;
}
