import { IsMongoId, IsString, IsNotEmpty } from 'class-validator';

export class TransferOwnershipDto {
  @IsMongoId()
  newOwnerId: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
