import { IsArray, ArrayMinSize, IsMongoId } from 'class-validator';

export class BulkDiscountIdsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one ID is required' })
  @IsMongoId({
    each: true,
    message: 'Each id must be a valid MongoDB ObjectId',
  })
  ids: string[];
}
