import { ApiProperty } from '@nestjs/swagger';

export class WebSearchQuotaDto {
  @ApiProperty({
    description: 'Current number of searches used today',
    example: 25,
  })
  count: number;

  @ApiProperty({
    description: 'Daily search limit',
    example: 100,
  })
  limit: number;

  @ApiProperty({
    description: 'Remaining searches available today',
    example: 75,
  })
  remaining?: number;
}
