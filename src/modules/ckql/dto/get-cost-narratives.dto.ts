import { IsArray, ArrayMinSize, IsString } from 'class-validator';

/**
 * DTO for POST /ckql/narratives - Get cost narratives for specific records.
 * record_ids are Telemetry document _id or span identifiers.
 */
export class GetCostNarrativesDto {
  @IsArray({ message: 'record_ids must be an array' })
  @ArrayMinSize(1, { message: 'record_ids must contain at least one id' })
  @IsString({ each: true })
  record_ids!: string[];
}
