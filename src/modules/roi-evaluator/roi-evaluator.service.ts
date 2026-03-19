import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { BenchmarkFetcherService } from './services/benchmark-fetcher.service';
import { RoiCalculatorService } from './services/roi-calculator.service';
import type { CalculateRoiDto } from './dto/calculate-roi.dto';
import type { RoiResultDto } from './dto/roi-result.dto';
import { RoiLead } from '../../schemas/roi/roi-lead.schema';
import { EmailService } from '../email/email.service';

@Injectable()
export class RoiEvaluatorService {
  private readonly logger = new Logger(RoiEvaluatorService.name);

  constructor(
    private readonly benchmarkFetcher: BenchmarkFetcherService,
    private readonly roiCalculator: RoiCalculatorService,
    @InjectModel(RoiLead.name) private readonly roiLeadModel: Model<RoiLead>,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Main orchestration: fetch benchmarks, compute ROI, return full result.
   */
  async calculate(dto: CalculateRoiDto): Promise<RoiResultDto> {
    const timeHorizon = dto.timeHorizon ?? 24;
    const useCaseNames = dto.useCases.map((uc) => uc.name);

    this.logger.log('Fetching benchmarks', {
      useCases: useCaseNames,
      industry: dto.industry,
    });
    const benchmarks = await this.benchmarkFetcher.fetchBenchmarks(
      useCaseNames,
      dto.industry,
    );

    const calcOutput = this.roiCalculator.calculate({
      useCases: dto.useCases,
      companySize: dto.companySize,
      implementationBudget: dto.implementationBudget,
      timeHorizonMonths: timeHorizon,
      currentAISpend: dto.currentAISpend,
      benchmarks,
    });

    const resultId = uuidv4();
    return {
      resultId,
      scenarios: calcOutput.scenarios,
      useCaseBreakdowns: calcOutput.useCaseBreakdowns,
      benchmarks,
      inputs: {
        industry: dto.industry,
        companySize: dto.companySize,
        annualRevenue: dto.annualRevenue,
        implementationBudget: dto.implementationBudget,
        timeHorizon,
      },
    };
  }

  /**
   * Save lead and optionally send report email.
   * When skipEmail is true (e.g. Resend sends from frontend), only store the lead.
   */
  async captureLead(
    email: string,
    companyName?: string,
    roiResult?: RoiResultDto,
    skipEmail?: boolean,
  ): Promise<{ success: boolean; message: string }> {
    const lead = await this.roiLeadModel.create({
      email: email.toLowerCase().trim(),
      companyName: companyName?.trim(),
      roiResultId: roiResult?.resultId,
      roiResultSnapshot: roiResult
        ? this.sanitizeForStorage(roiResult)
        : undefined,
    });

    if (skipEmail) {
      return { success: true, message: 'Request received.' };
    }

    try {
      const reportHtml = this.buildReportEmailHtml(roiResult);
      await this.emailService.sendEmail({
        to: email,
        subject: 'Your AI ROI Report from Cost Katana',
        html: reportHtml,
      });

      await this.roiLeadModel.updateOne(
        { _id: lead._id },
        { $set: { reportSent: true, reportSentAt: new Date() } },
      );

      return { success: true, message: 'Report sent to your email.' };
    } catch (emailError) {
      this.logger.warn('Email delivery failed for ROI lead (lead saved)', {
        email,
        leadId: lead._id,
        error:
          emailError instanceof Error ? emailError.message : String(emailError),
      });
      return {
        success: true,
        message:
          "We've received your request. Report delivery may be delayed—check your spam folder or contact support if you don't receive it.",
      };
    }
  }

  private sanitizeForStorage(result: RoiResultDto): Record<string, unknown> {
    return JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  }

  private buildReportEmailHtml(result?: RoiResultDto): string {
    if (!result) {
      return `
        <h2>Your AI ROI Report</h2>
        <p>Thank you for your interest in AI ROI evaluation.</p>
        <p>Visit <a href="https://costkatana.com/tools/roi-evaluator">Cost Katana ROI Evaluator</a> to run a custom analysis.</p>
      `;
    }

    const mod = result.scenarios.moderate;
    const inputs = result.inputs;
    return `
      <h2>Your AI ROI Report from Cost Katana</h2>
      <p><strong>Industry:</strong> ${inputs.industry} | <strong>Time horizon:</strong> ${inputs.timeHorizon} months</p>
      <h3>Moderate Scenario Summary</h3>
      <ul>
        <li>Net ROI: ${mod.netROIPercent.toFixed(1)}%</li>
        <li>Payback Period: ${mod.paybackPeriodMonths.toFixed(1)} months</li>
        <li>3-Year Savings: $${mod.threeYearSavings.toLocaleString()}</li>
        <li>Productivity Hours Saved: ${mod.productivityHoursSaved.toFixed(0)} hours</li>
      </ul>
      <p><a href="https://costkatana.com/tools/roi-evaluator">Run another analysis</a></p>
    `;
  }
}
