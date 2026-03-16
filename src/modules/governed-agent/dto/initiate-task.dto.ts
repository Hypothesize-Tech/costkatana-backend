import { IsNotEmpty, IsString } from 'class-validator';

export class InitiateTaskDto {
  @IsString()
  @IsNotEmpty()
  userRequest: string;
}
