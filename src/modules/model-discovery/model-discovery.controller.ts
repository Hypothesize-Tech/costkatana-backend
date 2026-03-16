import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModelDiscoveryService } from './services/model-discovery.service';
import { ModelDiscoveryJobService } from './services/model-discovery-job.service';
import {
  AIModelPricing,
  AIModelPricingDocument,
} from '../../schemas/ai/ai-model-pricing.schema';
import { GetModelsQueryDto } from './dto/get-models-query.dto';
import { UpdateModelDto } from './dto/update-model.dto';

@Controller('api/model-discovery')
@UseGuards(JwtAuthGuard)
export class ModelDiscoveryController {
  constructor(
    private readonly modelDiscoveryService: ModelDiscoveryService,
    private readonly modelDiscoveryJobService: ModelDiscoveryJobService,
    @InjectModel(AIModelPricing.name)
    private readonly aiModelPricingModel: Model<AIModelPricingDocument>,
  ) {}

  /**
   * Manually trigger model discovery for all providers
   * POST /api/model-discovery/trigger
   */
  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  async triggerDiscovery(@CurrentUser() user: { id?: string; _id?: string }) {
    const result = await this.modelDiscoveryJobService.trigger();

    return {
      success: result.success,
      message: result.message || 'Model discovery initiated',
      lastRun: result.lastRun,
      results: result.results,
    };
  }

  /**
   * Trigger discovery for a specific provider
   * POST /api/model-discovery/trigger/:provider
   */
  @Post('trigger/:provider')
  @HttpCode(HttpStatus.OK)
  async triggerProviderDiscovery(
    @Param('provider') provider: string,
    @CurrentUser() user: { id?: string; _id?: string },
  ) {
    if (!provider) {
      throw new BadRequestException('Provider parameter is required');
    }

    const result =
      await this.modelDiscoveryService.discoverModelsForProvider(provider);

    return {
      success: true,
      result,
    };
  }

  /**
   * Get discovery job status
   * GET /api/model-discovery/status
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getStatus() {
    const jobStatus = this.modelDiscoveryJobService.getStatus();
    const discoveryStatus =
      await this.modelDiscoveryService.getDiscoveryStatus();

    return {
      success: true,
      data: {
        ...jobStatus,
        ...discoveryStatus,
      },
    };
  }

  /**
   * Get all discovered models
   * GET /api/model-discovery/models
   */
  @Get('models')
  @HttpCode(HttpStatus.OK)
  async getAllModels(
    @Query() query: GetModelsQueryDto,
    @CurrentUser() user: { id?: string; _id?: string },
  ) {
    const { provider, active, latest } = query;
    const matchQuery: any = {};

    if (provider) {
      matchQuery.provider = provider;
    }
    if (active === true) {
      matchQuery.isActive = true;
      matchQuery.isDeprecated = false;
    }
    if (latest === true) {
      matchQuery.isLatest = true;
    }

    const models = await this.aiModelPricingModel
      .find(matchQuery)
      .sort({ provider: 1, isLatest: -1, modelName: 1 })
      .select('-llmExtractionPrompt -googleSearchSnippet -searchQuery')
      .lean();

    return {
      success: true,
      data: {
        models,
        count: models.length,
      },
    };
  }

  /**
   * Get models by provider
   * GET /api/model-discovery/models/:provider
   */
  @Get('models/:provider')
  @HttpCode(HttpStatus.OK)
  async getModelsByProvider(@Param('provider') provider: string) {
    if (!provider) {
      throw new BadRequestException('Provider parameter is required');
    }

    const models = await this.aiModelPricingModel
      .find({
        provider,
        isActive: true,
        validationStatus: 'verified',
      })
      .sort({ isLatest: -1, modelName: 1 })
      .lean();

    const lastUpdated = models.length > 0 ? models[0].lastUpdated : null;

    return {
      success: true,
      data: {
        provider,
        models,
        count: models.length,
        lastUpdated,
      },
    };
  }

  /**
   * Manually update a model
   * PUT /api/model-discovery/models/:modelId
   */
  @Put('models/:modelId')
  @HttpCode(HttpStatus.OK)
  async updateModel(
    @Param('modelId') modelId: string,
    @Body() updates: UpdateModelDto,
    @CurrentUser() user: { id?: string; _id?: string },
  ) {
    if (!modelId) {
      throw new BadRequestException('Model ID is required');
    }

    const model = await this.aiModelPricingModel.findOne({ modelId });

    if (!model) {
      throw new NotFoundException('Model not found');
    }

    // Update allowed fields
    const allowedFields = [
      'modelName',
      'inputPricePerMToken',
      'outputPricePerMToken',
      'cachedInputPricePerMToken',
      'contextWindow',
      'capabilities',
      'category',
      'isLatest',
      'isActive',
      'isDeprecated',
    ];

    for (const field of allowedFields) {
      if (updates[field as keyof UpdateModelDto] !== undefined) {
        (model as any)[field] = updates[field as keyof UpdateModelDto];
      }
    }

    model.lastUpdated = new Date();
    model.discoverySource = 'manual';

    await model.save();

    return {
      success: true,
      data: model,
    };
  }

  /**
   * Validate a model's pricing data
   * POST /api/model-discovery/validate/:modelId
   */
  @Post('validate/:modelId')
  @HttpCode(HttpStatus.OK)
  async validateModel(@Param('modelId') modelId: string) {
    if (!modelId) {
      throw new BadRequestException('Model ID is required');
    }

    const model = await this.aiModelPricingModel.findOne({ modelId });

    if (!model) {
      throw new NotFoundException('Model not found');
    }

    // Perform validation checks
    const validationResults = {
      priceRange:
        model.inputPricePerMToken >= 0 &&
        model.inputPricePerMToken <= 1000 &&
        model.outputPricePerMToken >= 0 &&
        model.outputPricePerMToken <= 1000,
      contextWindow:
        model.contextWindow >= 1000 && model.contextWindow <= 10000000,
      hasCapabilities: model.capabilities.length > 0,
      validCategory: ['text', 'multimodal', 'embedding', 'code'].includes(
        model.category,
      ),
    };

    const isValid = Object.values(validationResults).every((v) => v);

    model.validationStatus = isValid ? 'verified' : 'failed';
    model.lastValidated = new Date();
    await model.save();

    return {
      success: true,
      data: {
        modelId,
        isValid,
        validationResults,
        validationStatus: model.validationStatus,
      },
    };
  }
}
