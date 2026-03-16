import { IsNotEmpty, IsString } from 'class-validator';

export class RequestIdParamDto {
  @IsNotEmpty({ message: 'Request ID is required' })
  @IsString()
  requestId: string;
}
