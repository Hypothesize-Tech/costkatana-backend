import { IsString } from 'class-validator';

export class ClassifyMessageDto {
  @IsString()
  message: string;
}
