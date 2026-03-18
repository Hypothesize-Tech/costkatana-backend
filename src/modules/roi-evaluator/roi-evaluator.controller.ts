import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RoiEvaluatorService } from './roi-evaluator.service';
import { CalculateRoiDto } from './dto/calculate-roi.dto';
import { RoiLeadDto } from './dto/roi-lead.dto';

@Controller('roi-evaluator')
export class RoiEvaluatorController {
  constructor(private readonly roiEvaluatorService: RoiEvaluatorService) {}

  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async calculate(@Body() dto: CalculateRoiDto) {
    return this.roiEvaluatorService.calculate(dto);
  }

  @Post('lead')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async captureLead(@Body() dto: RoiLeadDto) {
    return this.roiEvaluatorService.captureLead(
      dto.email,
      dto.companyName,
      dto.roiResultSnapshot as
        | import('./dto/roi-result.dto').RoiResultDto
        | undefined,
      dto.skipEmail,
    );
  }
}
