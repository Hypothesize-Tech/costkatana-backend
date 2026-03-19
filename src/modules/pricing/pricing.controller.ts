import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RealtimePricingService } from './services/realtime-pricing.service';
import { WebScraperService } from './services/web-scraper.service';
import { CalculateCostsDto } from './dto/calculate-costs.dto';
import { AnalyzeTokensDto } from './dto/analyze-tokens.dto';
import { getModelPricing, estimateCost, formatCurrency } from '@/utils/pricing';

/**
 * Core Pricing Controller
 *
 * Handles core pricing operations including:
 * - Cost calculations for model usage
 * - Token analysis and optimization
 * - Service initialization
 * - Web scraping management
 */
@Controller('api/pricing')
export class PricingController {
  private readonly logger = new Logger(PricingController.name);

  constructor(
    private readonly realtimePricingService: RealtimePricingService,
    private readonly webScraperService: WebScraperService,
  ) {}

  /**
   * Get budget recommendations based on usage tier and optimization best practices
   * Matches Express GET /cost-estimation/budget-recommendations
   */
  @Get('budget-recommendations')
  async getBudgetRecommendations(
    @Query('userId') userId?: string,
    @Query('projectId') projectId?: string,
  ) {
    const tiers = [
      { min: 0, max: 50, label: 'Starter', recommended: 25 },
      { min: 50, max: 200, label: 'Growth', recommended: 100 },
      { min: 200, max: 1000, label: 'Scale', recommended: 500 },
      { min: 1000, max: Infinity, label: 'Enterprise', recommended: 2500 },
    ];
    return {
      success: true,
      data: {
        tiers: tiers.map((t) => ({
          ...t,
          maxFormatted: t.max === Infinity ? 'unlimited' : `$${t.max}`,
          suggestedAlerts: [60, 80, 95],
        })),
        recommendations: [
          'Set alerts at 60%, 80%, and 95% of budget to avoid surprises',
          'Use lower-cost models for high-volume, low-complexity tasks',
          'Enable semantic caching to reduce repeated API costs by 70-80%',
          'Consider reserved capacity or annual commits for predictable workloads',
        ],
        lastUpdated: new Date(),
      },
    };
  }

  /**
   * Calculate costs for model usage
   * Provides detailed cost breakdown including daily, monthly, and yearly estimates
   */
  @Post('tools/cost-calculator')
  async calculateCosts(@Body() dto: CalculateCostsDto) {
    const startTime = Date.now();
    try {
      const {
        provider,
        model,
        inputTokens,
        outputTokens,
        requestsPerDay = 1,
        daysPerMonth = 30,
      } = dto;

      const modelPricing = getModelPricing(provider, model);
      if (!modelPricing) {
        throw new HttpException(
          `Model ${model} not found for provider ${provider}`,
          HttpStatus.NOT_FOUND,
        );
      }

      const singleRequestCost = estimateCost(
        inputTokens,
        outputTokens,
        provider,
        model,
      );
      const dailyCost = singleRequestCost.totalCost * requestsPerDay;
      const monthlyCost = dailyCost * daysPerMonth;
      const yearlyCost = monthlyCost * 12;

      // Cost breakdown by token type
      const tokenBreakdown = {
        inputCostPerToken: modelPricing.inputPrice / 1_000_000,
        outputCostPerToken: modelPricing.outputPrice / 1_000_000,
        inputCostPerRequest: singleRequestCost.inputCost,
        outputCostPerRequest: singleRequestCost.outputCost,
      };

      // Volume discounts
      const volumeDiscounts = [];
      if (monthlyCost > 1000) {
        volumeDiscounts.push({
          threshold: 1000,
          discount: 5,
          savings: monthlyCost * 0.05,
        });
      }
      if (monthlyCost > 10000) {
        volumeDiscounts.push({
          threshold: 10000,
          discount: 10,
          savings: monthlyCost * 0.1,
        });
      }

      this.logger.log(
        `Costs calculated successfully for ${provider}/${model}`,
        {
          duration: Date.now() - startTime,
          monthlyCost,
        },
      );

      return {
        success: true,
        data: {
          model: {
            provider,
            modelId: model,
            modelName: modelPricing.modelName,
            inputPrice: modelPricing.inputPrice,
            outputPrice: modelPricing.outputPrice,
          },
          usage: {
            inputTokens,
            outputTokens,
            requestsPerDay,
            daysPerMonth,
          },
          costs: {
            perRequest: {
              input: singleRequestCost.inputCost,
              output: singleRequestCost.outputCost,
              total: singleRequestCost.totalCost,
              formatted: {
                input: formatCurrency(singleRequestCost.inputCost),
                output: formatCurrency(singleRequestCost.outputCost),
                total: formatCurrency(singleRequestCost.totalCost),
              },
            },
            daily: {
              total: dailyCost,
              formatted: formatCurrency(dailyCost),
            },
            monthly: {
              total: monthlyCost,
              formatted: formatCurrency(monthlyCost),
            },
            yearly: {
              total: yearlyCost,
              formatted: formatCurrency(yearlyCost),
            },
          },
          tokenBreakdown,
          volumeDiscounts,
          lastUpdated: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`Error calculating costs: ${error.message}`, {
        dto,
        duration: Date.now() - startTime,
      });
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to calculate costs',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Analyze tokens for text input
   * Provides token estimates and cost analysis across different models
   */
  @Post('tools/token-analyzer')
  async analyzeTokens(@Body() dto: AnalyzeTokensDto) {
    const startTime = Date.now();
    try {
      const { text, models = [] } = dto;

      // Simple token estimation (characters / 4 as rough approximation)
      const estimatedTokens = Math.ceil(text.length / 4);
      const wordCount = text.split(/\s+/).length;
      const charCount = text.length;

      // Analyze costs across different models
      const modelAnalysis = [];

      for (const modelInfo of models) {
        const { provider, modelId, outputTokens = estimatedTokens } = modelInfo;
        const modelPricing = getModelPricing(provider, modelId);

        if (modelPricing) {
          const costs = estimateCost(
            estimatedTokens,
            outputTokens,
            provider,
            modelId,
          );
          modelAnalysis.push({
            provider,
            modelId,
            modelName: modelPricing.modelName,
            inputTokens: estimatedTokens,
            outputTokens,
            costs: {
              input: costs.inputCost,
              output: costs.outputCost,
              total: costs.totalCost,
              formatted: {
                input: formatCurrency(costs.inputCost),
                output: formatCurrency(costs.outputCost),
                total: formatCurrency(costs.totalCost),
              },
            },
            efficiency: {
              costPerToken: costs.totalCost / (estimatedTokens + outputTokens),
              costPerWord: costs.totalCost / wordCount,
              costPerChar: costs.totalCost / charCount,
            },
          });
        }
      }

      // Find most cost-effective model
      const sortedByEfficiency = modelAnalysis.sort(
        (a, b) => a.costs.total - b.costs.total,
      );
      const mostEfficient = sortedByEfficiency[0];
      const leastEfficient = sortedByEfficiency[sortedByEfficiency.length - 1];

      // Token optimization suggestions
      const suggestions = [];
      if (estimatedTokens > 1000) {
        suggestions.push(
          'Consider breaking down large texts into smaller chunks for better cost efficiency',
        );
      }
      if (wordCount / estimatedTokens < 0.6) {
        suggestions.push(
          'Text appears to have many technical terms or special characters - actual token count may be higher',
        );
      }
      suggestions.push('Use prompt engineering to reduce output tokens needed');
      suggestions.push(
        'Consider caching responses for repeated similar inputs',
      );

      this.logger.log('Token analysis completed', {
        duration: Date.now() - startTime,
        estimatedTokens,
        modelsAnalyzed: modelAnalysis.length,
      });

      return {
        success: true,
        data: {
          textAnalysis: {
            charCount,
            wordCount,
            estimatedTokens,
            averageTokensPerWord: estimatedTokens / wordCount,
            averageCharsPerToken: charCount / estimatedTokens,
          },
          modelAnalysis,
          comparison: {
            mostEfficient: mostEfficient
              ? {
                  model: `${mostEfficient.provider} ${mostEfficient.modelName}`,
                  cost: mostEfficient.costs.formatted.total,
                }
              : null,
            leastEfficient: leastEfficient
              ? {
                  model: `${leastEfficient.provider} ${leastEfficient.modelName}`,
                  cost: leastEfficient.costs.formatted.total,
                }
              : null,
            potentialSavings:
              mostEfficient && leastEfficient
                ? formatCurrency(
                    leastEfficient.costs.total - mostEfficient.costs.total,
                  )
                : null,
          },
          suggestions,
          lastUpdated: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`Error analyzing tokens: ${error.message}`, {
        dto,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to analyze tokens',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Initialize pricing service
   * Starts the real-time pricing service and loads initial data
   */
  @Post('initialize')
  async initialize() {
    const startTime = Date.now();
    try {
      await this.realtimePricingService.updateAllPricing();

      this.logger.log('Pricing service initialized successfully', {
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Pricing service initialized successfully',
      };
    } catch (error) {
      this.logger.error(
        `Error initializing pricing service: ${error.message}`,
        { duration: Date.now() - startTime },
      );
      throw new HttpException(
        'Failed to initialize pricing service',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Test web scraping for a specific provider
   * Returns scraping test results including content preview
   */
  @Get('test-scraping/:provider')
  async testScraping(@Param('provider') provider: string) {
    const startTime = Date.now();
    try {
      if (!provider) {
        throw new HttpException(
          'Provider parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.webScraperService.testScraping(provider);

      this.logger.log('Test scraping completed', {
        duration: Date.now() - startTime,
        provider,
        success: result.success,
      });

      return {
        success: true,
        data: {
          provider: result.provider,
          url: result.url,
          success: result.success,
          contentLength: result.content.length,
          scrapedAt: result.scrapedAt,
          error: result.error,
          // Only include first 1000 chars of content for testing
          contentPreview:
            result.content.substring(0, 1000) +
            (result.content.length > 1000 ? '...' : ''),
        },
      };
    } catch (error) {
      this.logger.error(
        `Error testing scraping for ${provider}: ${error.message}`,
        { duration: Date.now() - startTime },
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to test scraping',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Trigger web scraping for providers
   * Initiates background scraping for specified providers or all providers
   */
  @Post('scrape')
  async triggerScraping(@Body() body: { providers?: string[] }) {
    const startTime = Date.now();
    try {
      const { providers } = body;
      const providersToScrape =
        providers && providers.length > 0
          ? providers
          : [
              'OpenAI',
              'Anthropic',
              'Google AI',
              'AWS Bedrock',
              'Cohere',
              'Mistral',
              'Grok',
            ];

      // Start scraping in background (don't wait for completion)
      const results = await this.webScraperService.scrapeAllProviders();

      this.logger.log('Web scraping completed', {
        duration: Date.now() - startTime,
        providersCount: results.length,
      });

      // Return immediately with status
      return {
        success: true,
        data: {
          message: 'Web scraping completed',
          scrapingStatus: results.map((result) => ({
            provider: result.provider,
            status: result.success ? 'completed' : 'failed',
            progress: result.success ? 100 : 0,
            message: result.success
              ? 'Scraping completed'
              : result.error || 'Scraping failed',
            lastAttempt: result.scrapedAt,
          })),
        },
      };
    } catch (error) {
      this.logger.error(`Error triggering scraping: ${error.message}`, {
        body,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to trigger scraping',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
