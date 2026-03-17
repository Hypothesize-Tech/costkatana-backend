import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateConversationModelDto {
  @ApiProperty({
    description: 'The new AI model ID to use for this conversation',
    example: 'gpt-4o',
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  modelId: string;
}
