import { IsString, IsNotEmpty } from 'class-validator';

export class ConversationIdParamDto {
  @IsString()
  @IsNotEmpty({ message: 'Valid conversation ID is required' })
  conversationId: string;
}
