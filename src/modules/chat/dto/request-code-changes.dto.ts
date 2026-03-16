import { IsString } from 'class-validator';

export class RequestCodeChangesDto {
  @IsString()
  changeRequest: string;
}
