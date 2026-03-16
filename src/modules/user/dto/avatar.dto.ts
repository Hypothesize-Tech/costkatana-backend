import { IsString } from 'class-validator';

export class PresignedAvatarUrlDto {
  @IsString()
  fileName: string;

  @IsString()
  fileType: string;
}
