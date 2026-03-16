import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  VisualComplianceOptimizedService,
  VisualComplianceRequest,
} from './services/visual-compliance-optimized.service';
import { VisualComplianceS3Service } from './services/visual-compliance-s3.service';
import { MetaPromptPresetsService } from './services/meta-prompt-presets.service';
import { AiCostTrackingService } from './services/ai-cost-tracking.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Optimization,
  OptimizationDocument,
} from '../../schemas/core/optimization.schema';
import { Usage, UsageDocument } from '../../schemas/core/usage.schema';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import {
  checkComplianceSchema,
  batchCheckSchema,
} from './dto/visual-compliance.dto';
import type {
  CheckComplianceDto,
  BatchCheckDto,
} from './dto/visual-compliance.dto';

@Controller('api/visual-compliance')
@UseGuards(JwtAuthGuard)
export class VisualComplianceController {
  private readonly logger = new Logger(VisualComplianceController.name);

  constructor(
    private readonly complianceService: VisualComplianceOptimizedService,
    private readonly s3Service: VisualComplianceS3Service,
    private readonly metaPromptService: MetaPromptPresetsService,
    private readonly costTrackingService: AiCostTrackingService,
    @InjectModel(Optimization.name)
    private readonly optimizationModel: Model<OptimizationDocument>,
    @InjectModel(Usage.name) private readonly usageModel: Model<UsageDocument>,
  ) {}

  /**
   * POST /api/visual-compliance/check-optimized
   * Ultra-optimized visual compliance check (feature-based)
   */
  @Post('check-optimized')
  async checkComplianceOptimized(
    @Body(ZodPipe(checkComplianceSchema)) body: CheckComplianceDto,
    @CurrentUser() user: any,
  ) {
    const startTime = Date.now();
    const userId = user.id;

    // Validation
    if (!body.referenceImage || !body.evidenceImage) {
      throw new HttpException(
        'Both referenceImage and evidenceImage are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      !body.complianceCriteria ||
      !Array.isArray(body.complianceCriteria) ||
      body.complianceCriteria.length === 0
    ) {
      throw new HttpException(
        'complianceCriteria must be a non-empty array',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      !['jewelry', 'grooming', 'retail', 'fmcg', 'documents'].includes(
        body.industry,
      )
    ) {
      throw new HttpException(
        'Invalid industry. Must be one of: jewelry, grooming, retail, fmcg, documents',
        HttpStatus.BAD_REQUEST,
      );
    }

    const projectId = body.projectId;
    const mode = body.mode || 'optimized';

    try {
      const request: VisualComplianceRequest = {
        referenceImage: body.referenceImage,
        evidenceImage: body.evidenceImage,
        complianceCriteria: body.complianceCriteria,
        industry: body.industry,
        userId,
        templateId: body.templateId,
        projectId,
        useUltraCompression: body.useUltraCompression ?? true,
        mode,
        metaPrompt: body.metaPrompt,
        metaPromptPresetId: body.metaPromptPresetId,
      };

      const result =
        await this.complianceService.processComplianceCheckOptimized(request);

      // Use cost breakdown from service if available, otherwise calculate
      const costBreakdown = result.metadata.costBreakdown;
      const baselineCost = costBreakdown?.baseline.totalCost ?? 0.0043;
      const costSavings =
        costBreakdown?.savings.percentage ??
        (1 - result.metadata.cost / baselineCost) * 100;

      // For standard mode, we're not optimizing for cost but for accuracy
      // So we need to handle the case where actual cost is higher than baseline
      const actualCostSaved =
        costBreakdown?.savings.amount ?? baselineCost - result.metadata.cost;
      const actualImprovementPercentage = costSavings;

      // Upload images to S3
      let referenceImageUrl = '';
      let evidenceImageUrl = '';

      try {
        // Upload reference image to S3
        const referenceBuffer = Buffer.from(
          typeof body.referenceImage === 'string'
            ? body.referenceImage.replace(/^data:image\/\w+;base64,/, '')
            : body.referenceImage,
          'base64',
        );
        const refUpload = await this.s3Service.uploadDocument(
          userId === 'anonymous' ? 'anonymous' : userId,
          `visual-compliance-reference-${Date.now()}.jpg`,
          referenceBuffer,
          'image/jpeg',
          { type: 'visual-compliance-reference', industry: body.industry },
        );
        referenceImageUrl = refUpload.s3Url;

        // Upload evidence image to S3
        const evidenceBuffer = Buffer.from(
          typeof body.evidenceImage === 'string'
            ? body.evidenceImage.replace(/^data:image\/\w+;base64,/, '')
            : body.evidenceImage,
          'base64',
        );
        const evidUpload = await this.s3Service.uploadDocument(
          userId === 'anonymous' ? 'anonymous' : userId,
          `visual-compliance-evidence-${Date.now()}.jpg`,
          evidenceBuffer,
          'image/jpeg',
          { type: 'visual-compliance-evidence', industry: body.industry },
        );
        evidenceImageUrl = evidUpload.s3Url;

        this.logger.log('Visual compliance images uploaded to S3', {
          userId,
          referenceUrl: referenceImageUrl,
          evidenceUrl: evidenceImageUrl,
        });
      } catch (uploadError) {
        this.logger.error('Failed to upload images to S3', {
          error:
            uploadError instanceof Error
              ? uploadError.message
              : String(uploadError),
          userId,
        });
        // Continue without S3 URLs if upload fails
      }

      // Record usage
      await this.usageModel.create({
        userId: userId === 'anonymous' ? undefined : userId,
        userQuery: `Visual Compliance Check (${mode}): ${body.industry}`,
        generatedAnswer: `${result.pass_fail ? 'PASS' : 'FAIL'} - Score: ${result.compliance_score}% - ${result.feedback_message}`,
        service: 'visual-compliance',
        model:
          mode === 'optimized'
            ? 'amazon.nova-pro-v1:0'
            : 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        inputTokens: result.metadata.inputTokens,
        outputTokens: result.metadata.outputTokens,
        estimatedCost: result.metadata.cost,
        latency: result.metadata.latency,
        success: true,
        metadata: {
          complianceScore: result.compliance_score,
          passFail: result.pass_fail,
          costSavings,
          compressionRatio: result.metadata.compressionRatio,
          technique: result.metadata.technique,
          industry: body.industry,
          mode,
        },
      });

      // Record optimization
      await this.optimizationModel.create({
        userId: userId === 'anonymous' ? undefined : userId,
        service: 'visual-compliance',
        optimizationType:
          mode === 'optimized'
            ? 'visual_compliance'
            : 'visual_compliance_standard',
        inputTokens: result.metadata.inputTokens,
        outputTokens: result.metadata.outputTokens,
        baselineCost,
        optimizedCost: result.metadata.cost,
        costSaved: Math.max(0, actualCostSaved),
        improvementPercentage: Math.max(0, actualImprovementPercentage),
        compressionRatio: result.metadata.compressionRatio,
        technique: result.metadata.technique,
        metadata: {
          complianceScore: result.compliance_score,
          passFail: result.pass_fail,
          industry: body.industry,
          mode,
          visualComplianceData: {
            referenceImageUrl,
            evidenceImageUrl,
            complianceScore: result.compliance_score,
            passFail: result.pass_fail,
            feedbackMessage: result.feedback_message,
            industry: body.industry,
            complianceCriteria: body.complianceCriteria,
          },
          cortexImpactMetrics: {
            score: result.compliance_score,
            pass: result.pass_fail,
            feedback: result.feedback_message,
            items: result.items,
          },
        },
        suggestions: [],
        tags: ['visual-compliance', 'cortex', 'toon', body.industry],
      });

      this.logger.log('Visual compliance check completed', {
        industry: body.industry,
        mode,
        costSavings: costSavings.toFixed(1),
        processingTime: Date.now() - startTime,
      });

      return {
        success: true,
        data: result,
        optimization: {
          technique: result.metadata.technique,
          tokenReduction: `${result.metadata.compressionRatio.toFixed(1)}%`,
          costSavings: `${costSavings.toFixed(1)}%`,
        },
        // Include detailed cost breakdown for internal visibility
        costBreakdown: costBreakdown
          ? {
              optimized: {
                inputTokens: costBreakdown.optimized.inputTokens,
                outputTokens: costBreakdown.optimized.outputTokens,
                inputCost: `$${costBreakdown.optimized.inputCost.toFixed(6)}`,
                outputCost: `$${costBreakdown.optimized.outputCost.toFixed(6)}`,
                totalCost: `$${costBreakdown.optimized.totalCost.toFixed(6)}`,
              },
              baseline: {
                inputTokens: costBreakdown.baseline.inputTokens,
                outputTokens: costBreakdown.baseline.outputTokens,
                inputCost: `$${costBreakdown.baseline.inputCost.toFixed(6)}`,
                outputCost: `$${costBreakdown.baseline.outputCost.toFixed(6)}`,
                totalCost: `$${costBreakdown.baseline.totalCost.toFixed(6)}`,
              },
              savings: {
                amount: `$${costBreakdown.savings.amount.toFixed(6)}`,
                percentage: `${costBreakdown.savings.percentage.toFixed(1)}%`,
                tokenReduction: `${costBreakdown.savings.tokenReduction.toFixed(1)}%`,
              },
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error('Visual compliance check failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        body,
        processingTime: Date.now() - startTime,
      });

      throw new HttpException(
        `Failed to process compliance check: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * POST /api/visual-compliance/batch
   * Process multiple compliance checks in parallel
   */
  @Post('batch')
  async batchCheck(
    @Body(ZodPipe(batchCheckSchema)) body: BatchCheckDto,
    @CurrentUser() user: any,
  ) {
    const startTime = Date.now();
    const userId = user.id;

    try {
      if (!Array.isArray(body.requests) || body.requests.length === 0) {
        throw new HttpException(
          'requests array is required and must not be empty',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (body.requests.length > 10) {
        throw new HttpException(
          'Maximum 10 requests allowed in batch',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Validate each request
      for (const request of body.requests) {
        if (!request.referenceImage || !request.evidenceImage) {
          throw new HttpException(
            'Each request must have referenceImage and evidenceImage',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (
          !request.complianceCriteria ||
          !Array.isArray(request.complianceCriteria)
        ) {
          throw new HttpException(
            'Each request must have complianceCriteria array',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (
          !['jewelry', 'grooming', 'retail', 'fmcg', 'documents'].includes(
            request.industry,
          )
        ) {
          throw new HttpException(
            'Invalid industry in one or more requests',
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // Process all requests in parallel
      const results = await Promise.allSettled(
        body.requests.map((req) =>
          this.complianceService.processComplianceCheckOptimized({
            ...req,
            userId,
          }),
        ),
      );

      const successResults = results.map((result, index) => ({
        index,
        success: result.status === 'fulfilled',
        data: result.status === 'fulfilled' ? result.value : null,
        error:
          result.status === 'rejected'
            ? (result.reason as Error).message
            : null,
      }));

      const successful = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;
      const totalCost = successResults
        .filter((r) => r.success && r.data)
        .reduce((sum, r) => sum + (r.data?.metadata.cost || 0), 0);

      this.logger.log('Batch compliance check completed', {
        total: results.length,
        successful,
        failed,
        processingTime: Date.now() - startTime,
      });

      return {
        success: true,
        results: successResults,
        summary: {
          total: results.length,
          successful,
          failed,
          totalCost: totalCost.toFixed(6),
        },
      };
    } catch (error) {
      this.logger.error('Batch compliance check failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        processingTime: Date.now() - startTime,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to process batch check: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /api/visual-compliance/presets
   * Get available quality presets and their characteristics
   */
  @Get('presets')
  getPresets() {
    return {
      success: true,
      presets: {
        economy: {
          description: 'Lowest cost, good for high-volume screening',
          maxDimensions: '768x768',
          estimatedTokensPerImage: 900,
          estimatedCostPerRequest: '$0.0024',
          accuracy: 'Good',
          recommendedFor: ['initial screening', 'high volume', 'non-critical'],
        },
        balanced: {
          description: 'Optimal cost/quality balance (RECOMMENDED)',
          maxDimensions: '1024x1024',
          estimatedTokensPerImage: 1600,
          estimatedCostPerRequest: '$0.0043',
          accuracy: 'Very Good',
          recommendedFor: [
            'general compliance',
            'retail audits',
            'standard checks',
          ],
        },
        premium: {
          description: 'Highest quality for critical compliance',
          maxDimensions: '1568x1568',
          estimatedTokensPerImage: 3400,
          estimatedCostPerRequest: '$0.0091',
          accuracy: 'Excellent',
          recommendedFor: [
            'luxury brands',
            'legal compliance',
            'critical audits',
          ],
        },
      },
      note: 'Current implementation uses feature extraction which achieves 96% token reduction regardless of preset',
    };
  }

  /**
   * GET /api/visual-compliance/cost-comparison
   * Get cost comparison dashboard data from real usage statistics
   */
  @Get('cost-comparison')
  async getCostComparison() {
    const startTime = Date.now();

    try {
      // Get actual usage statistics for visual-compliance service
      const actualStats = await this.usageModel.aggregate([
        {
          $match: {
            service: 'visual-compliance',
            model: {
              $in: [
                'amazon.nova-pro-v1:0',
                'amazon.nova-lite-v1:0',
                'amazon.nova-micro-v1:0',
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            avgInputTokens: { $avg: '$inputTokens' },
            avgOutputTokens: { $avg: '$outputTokens' },
            avgTotalTokens: {
              $avg: { $add: ['$inputTokens', '$outputTokens'] },
            },
            avgCost: { $avg: '$estimatedCost' },
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$estimatedCost' },
            totalTokens: { $sum: { $add: ['$inputTokens', '$outputTokens'] } },
          },
        },
      ]);

      // Get Nova Pro pricing (simplified)
      const inputPricePer1M = 0.8;
      const outputPricePer1M = 3.2;

      // Calculate actual optimized metrics from real data
      const actualOptimized = actualStats[0] ?? {
        avgInputTokens: 150,
        avgOutputTokens: 50,
        avgTotalTokens: 200,
        avgCost: 0.0003,
        totalRequests: 0,
      };

      // Calculate traditional (unoptimized) metrics
      // Traditional approach: Full image transmission (2 images at ~2000 tokens each) + prompt + JSON output
      const traditionalInputTokens = 4000; // 2 images at ~2000 tokens each
      const traditionalOutputTokens = 400; // JSON response
      const traditionalTotalTokens =
        traditionalInputTokens + traditionalOutputTokens;
      const traditionalCost =
        (traditionalInputTokens / 1_000_000) * inputPricePer1M +
        (traditionalOutputTokens / 1_000_000) * outputPricePer1M;

      // Calculate savings
      const tokenReduction =
        actualOptimized.totalRequests > 0 && actualOptimized.avgTotalTokens
          ? (1 - actualOptimized.avgTotalTokens / traditionalTotalTokens) * 100
          : 95.1; // Default if no data
      const costReduction =
        actualOptimized.totalRequests > 0 && actualOptimized.avgCost
          ? (1 - actualOptimized.avgCost / traditionalCost) * 100
          : 93.0; // Default if no data

      this.logger.log('Cost comparison calculated', {
        processingTime: Date.now() - startTime,
      });

      return {
        success: true,
        comparison: {
          traditional: {
            inputTokens: traditionalInputTokens,
            outputTokens: traditionalOutputTokens,
            totalTokens: traditionalTotalTokens,
            cost: parseFloat(traditionalCost.toFixed(6)),
            description: 'Full image transmission with JSON output (baseline)',
          },
          optimized: {
            inputTokens: Math.round(actualOptimized.avgInputTokens ?? 150),
            outputTokens: Math.round(actualOptimized.avgOutputTokens ?? 50),
            totalTokens: Math.round(actualOptimized.avgTotalTokens ?? 200),
            cost: parseFloat((actualOptimized.avgCost ?? 0.0003).toFixed(6)),
            description:
              'Feature extraction + TOON + Cortex LISP (actual usage)',
          },
          savings: {
            tokenReduction: parseFloat(tokenReduction.toFixed(1)),
            costReduction: parseFloat(costReduction.toFixed(1)),
            technique: 'feature_extraction_toon_cortex',
            basedOnRequests: actualOptimized.totalRequests,
          },
          breakdown: {
            featureExtraction: {
              reduction: 90,
              description: 'Extract visual features instead of raw pixels',
            },
            toonEncoding: {
              reduction: 40,
              description: 'Encode features as TOON format',
            },
            cortexOutput: {
              reduction: 87,
              description: 'Use Cortex LISP for structured output',
            },
          },
          metadata: {
            dataSource:
              actualOptimized.totalRequests > 0 ? 'real_usage' : 'estimated',
            sampleSize: actualOptimized.totalRequests,
            lastUpdated: new Date().toISOString(),
          },
        },
      };
    } catch (error) {
      this.logger.error('Cost comparison calculation failed', {
        error: error instanceof Error ? error.message : String(error),
        processingTime: Date.now() - startTime,
      });

      // Fallback to estimated values if database query fails
      const traditionalInputTokens = 4000;
      const traditionalOutputTokens = 400;
      const traditionalTotalTokens = 4400;
      const traditionalCost =
        (traditionalInputTokens / 1_000_000) * 0.8 +
        (traditionalOutputTokens / 1_000_000) * 3.2;

      const optimizedInputTokens = 150;
      const optimizedOutputTokens = 50;
      const optimizedTotalTokens = 200;
      const optimizedCost =
        (optimizedInputTokens / 1_000_000) * 0.8 +
        (optimizedOutputTokens / 1_000_000) * 3.2;

      return {
        success: true,
        comparison: {
          traditional: {
            inputTokens: traditionalInputTokens,
            outputTokens: traditionalOutputTokens,
            totalTokens: traditionalTotalTokens,
            cost: parseFloat(traditionalCost.toFixed(6)),
            description: 'Full image transmission with JSON output (estimated)',
          },
          optimized: {
            inputTokens: optimizedInputTokens,
            outputTokens: optimizedOutputTokens,
            totalTokens: optimizedTotalTokens,
            cost: parseFloat(optimizedCost.toFixed(6)),
            description: 'Feature extraction + TOON + Cortex LISP (estimated)',
          },
          savings: {
            tokenReduction: 95.5,
            costReduction: 93.0,
            technique: 'feature_extraction_toon_cortex',
          },
          breakdown: {
            featureExtraction: {
              reduction: 90,
              description: 'Extract visual features instead of raw pixels',
            },
            toonEncoding: {
              reduction: 40,
              description: 'Encode features as TOON format',
            },
            cortexOutput: {
              reduction: 87,
              description: 'Use Cortex LISP for structured output',
            },
          },
          metadata: {
            dataSource: 'estimated',
            sampleSize: 0,
            lastUpdated: new Date().toISOString(),
            note: 'Using estimated values due to database query error',
          },
        },
      };
    }
  }

  /**
   * GET /api/visual-compliance/meta-prompt-presets
   * Get available meta prompt presets
   */
  @Get('meta-prompt-presets')
  async getMetaPromptPresets() {
    const startTime = Date.now();

    try {
      const presets = this.metaPromptService.getAllPresets();

      // Return presets with minimal information (don't send full prompts in list)
      const presetsInfo = presets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        industry: preset.industry,
        description: preset.description,
      }));

      this.logger.log('Meta prompt presets retrieved', {
        count: presets.length,
        processingTime: Date.now() - startTime,
      });

      return {
        success: true,
        presets: presetsInfo,
      };
    } catch (error) {
      this.logger.error('Failed to retrieve meta prompt presets', {
        error: error instanceof Error ? error.message : String(error),
        processingTime: Date.now() - startTime,
      });

      throw new HttpException(
        `Failed to retrieve presets: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /api/visual-compliance/meta-prompt-presets/:id
   * Get a specific meta prompt preset by ID
   */
  @Get('meta-prompt-presets/:id')
  async getMetaPromptPresetById(@Param('id') id: string) {
    const startTime = Date.now();

    try {
      const preset = this.metaPromptService.getPresetById(id);

      if (!preset) {
        throw new HttpException('Preset not found', HttpStatus.NOT_FOUND);
      }

      this.logger.log('Meta prompt preset retrieved', {
        presetId: id,
        processingTime: Date.now() - startTime,
      });

      return {
        success: true,
        preset,
      };
    } catch (error) {
      this.logger.error('Failed to retrieve meta prompt preset', {
        error: error instanceof Error ? error.message : String(error),
        presetId: id,
        processingTime: Date.now() - startTime,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to retrieve preset: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
