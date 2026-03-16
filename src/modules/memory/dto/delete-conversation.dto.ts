import { IsString, IsNotEmpty } from 'class-validator';

export class DeleteConversationDto {
  @IsString()
  @IsNotEmpty({ message: 'User ID is required' })
  userId: string;
}
