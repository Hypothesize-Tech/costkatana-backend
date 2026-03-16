import { IsNotEmpty, IsString } from 'class-validator';

export class PresignedUrlQueryDto {
  @IsNotEmpty({ message: 'S3 key is required' })
  @IsString()
  s3Key: string;
}
