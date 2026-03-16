import { IsString, IsNotEmpty } from 'class-validator';

export class UserIdParamDto {
  @IsString()
  @IsNotEmpty({ message: 'Valid user ID is required' })
  userId: string;
}
