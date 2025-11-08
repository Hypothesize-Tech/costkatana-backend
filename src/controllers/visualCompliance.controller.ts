import {  Response } from 'express';
import { VisualComplianceOptimizedService } from '../services/visualComplianceOptimized.service';
import { loggingService } from '../services/logging.service';
import { Usage } from '../models/Usage';
import { AWS_BEDROCK_PRICING } from '../utils/pricing/aws-bedrock';

export class VisualComplianceController {
  
  /**
   * POST /api/visual-compliance/check-optimized
   * Ultra-optimized visual compliance check (feature-based)
   */
  static async checkComplianceOptimized(req: any, res: Response): Promise<Response> {
    try {
      const {
        referenceImage,
        evidenceImage,
        complianceCriteria,
        industry,
        useUltraCompression = true
      } = req.body;

      // Validation
      if (!referenceImage || !evidenceImage) {
        return res.status(400).json({
          success: false,
          error: 'Both referenceImage and evidenceImage are required'
        });
      }

      if (!complianceCriteria || !Array.isArray(complianceCriteria) || complianceCriteria.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'complianceCriteria must be a non-empty array'
        });
      }

      if (!['jewelry', 'grooming', 'retail', 'fmcg', 'documents'].includes(industry)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid industry. Must be one of: jewelry, grooming, retail, fmcg, documents'
        });
      }

      const userId = (req.user as any)?._id?.toString() || 'anonymous';
      const projectId = req.body.projectId;

      const result = await VisualComplianceOptimizedService.processComplianceCheckOptimized({
        referenceImage,
        evidenceImage,
        complianceCriteria,
        industry,
        userId,
        projectId,
        useUltraCompression
      });

      // Use cost breakdown from service if available, otherwise calculate
      const costBreakdown = result.metadata.costBreakdown;
      const baselineCost = costBreakdown?.baseline.totalCost ?? 0.0043;
      const costSavings = costBreakdown?.savings.percentage ?? ((1 - result.metadata.cost / baselineCost) * 100);

      return res.status(200).json({
        success: true,
        data: result,
        optimization: {
          technique: result.metadata.technique,
          tokenReduction: `${result.metadata.compressionRatio.toFixed(1)}%`,
          costSavings: `${costSavings.toFixed(1)}%`
        },
        // Include detailed cost breakdown for internal visibility
        costBreakdown: costBreakdown ? {
          optimized: {
            inputTokens: costBreakdown.optimized.inputTokens,
            outputTokens: costBreakdown.optimized.outputTokens,
            inputCost: `$${costBreakdown.optimized.inputCost.toFixed(6)}`,
            outputCost: `$${costBreakdown.optimized.outputCost.toFixed(6)}`,
            totalCost: `$${costBreakdown.optimized.totalCost.toFixed(6)}`
          },
          baseline: {
            inputTokens: costBreakdown.baseline.inputTokens,
            outputTokens: costBreakdown.baseline.outputTokens,
            inputCost: `$${costBreakdown.baseline.inputCost.toFixed(6)}`,
            outputCost: `$${costBreakdown.baseline.outputCost.toFixed(6)}`,
            totalCost: `$${costBreakdown.baseline.totalCost.toFixed(6)}`
          },
          savings: {
            amount: `$${costBreakdown.savings.amount.toFixed(6)}`,
            percentage: `${costBreakdown.savings.percentage.toFixed(1)}%`,
            tokenReduction: `${costBreakdown.savings.tokenReduction.toFixed(1)}%`
          }
        } : undefined
      });

    } catch (error) {
      loggingService.error('Visual compliance check failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: (req.user as any)?._id?.toString()
      });

      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * POST /api/visual-compliance/batch
   * Process multiple compliance checks in parallel
   */
  static async batchCheck(req: any, res: Response): Promise<Response> {
    try {
      const { requests } = req.body;

      if (!Array.isArray(requests) || requests.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'requests array is required and must not be empty'
        });
      }

      if (requests.length > 10) {
        return res.status(400).json({
          success: false,
          error: 'Maximum 10 requests allowed in batch'
        });
      }

      const userId = (req.user as any)?._id?.toString() || 'anonymous';

      // Validate each request
      for (const request of requests) {
        if (!request.referenceImage || !request.evidenceImage) {
          return res.status(400).json({
            success: false,
            error: 'Each request must have referenceImage and evidenceImage'
          });
        }
        if (!request.complianceCriteria || !Array.isArray(request.complianceCriteria)) {
          return res.status(400).json({
            success: false,
            error: 'Each request must have complianceCriteria array'
          });
        }
        if (!['jewelry', 'grooming', 'retail', 'fmcg', 'documents'].includes(request.industry)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid industry in one or more requests'
          });
        }
      }

      // Process all requests in parallel
      const results = await Promise.allSettled(
        requests.map(req => 
          VisualComplianceOptimizedService.processComplianceCheckOptimized({
            ...req,
            userId
          })
        )
      );

      const successResults = results.map((result, index) => ({
        index,
        success: result.status === 'fulfilled',
        data: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? (result.reason as Error).message : null
      }));

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      const totalCost = successResults
        .filter(r => r.success && r.data)
        .reduce((sum, r) => sum + (r.data?.metadata.cost || 0), 0);

      return res.status(200).json({
        success: true,
        results: successResults,
        summary: {
          total: results.length,
          successful,
          failed,
          totalCost: totalCost.toFixed(6)
        }
      });

    } catch (error) {
      loggingService.error('Batch compliance check failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * GET /api/visual-compliance/presets
   * Get available quality presets and their characteristics
   */
  static async getPresets(_req: any, res: Response): Promise<Response> {
    return res.status(200).json({
      success: true,
      presets: {
        economy: {
          description: 'Lowest cost, good for high-volume screening',
          maxDimensions: '768x768',
          estimatedTokensPerImage: 900,
          estimatedCostPerRequest: '$0.0024',
          accuracy: 'Good',
          recommendedFor: ['initial screening', 'high volume', 'non-critical']
        },
        balanced: {
          description: 'Optimal cost/quality balance (RECOMMENDED)',
          maxDimensions: '1024x1024',
          estimatedTokensPerImage: 1600,
          estimatedCostPerRequest: '$0.0043',
          accuracy: 'Very Good',
          recommendedFor: ['general compliance', 'retail audits', 'standard checks']
        },
        premium: {
          description: 'Highest quality for critical compliance',
          maxDimensions: '1568x1568',
          estimatedTokensPerImage: 3400,
          estimatedCostPerRequest: '$0.0091',
          accuracy: 'Excellent',
          recommendedFor: ['luxury brands', 'legal compliance', 'critical audits']
        }
      },
      note: 'Current implementation uses feature extraction which achieves 96% token reduction regardless of preset'
    });
  }

  /**
   * GET /api/visual-compliance/cost-comparison
   * Get cost comparison dashboard data from real usage statistics
   */
  static async getCostComparison(_req: any, res: Response): Promise<Response> {
    try {
      // Get actual usage statistics for visual-compliance service
      const actualStats = await Usage.aggregate([
        {
          $match: {
            service: 'visual-compliance',
            model: { $in: ['amazon.nova-pro-v1:0', 'amazon.nova-lite-v1:0', 'amazon.nova-micro-v1:0'] }
          }
        },
        {
          $group: {
            _id: null,
            avgInputTokens: { $avg: '$promptTokens' },
            avgOutputTokens: { $avg: '$completionTokens' },
            avgTotalTokens: { $avg: '$totalTokens' },
            avgCost: { $avg: '$cost' },
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' }
          }
        }
      ]);

      // Get Nova Pro pricing
      const novaProPricing = AWS_BEDROCK_PRICING.find(p => p.modelId === 'amazon.nova-pro-v1:0');
      const inputPricePer1M = novaProPricing?.inputPrice ?? 0.80;
      const outputPricePer1M = novaProPricing?.outputPrice ?? 3.20;

      // Calculate actual optimized metrics from real data
      interface OptimizedStats {
        avgInputTokens?: number;
        avgOutputTokens?: number;
        avgTotalTokens?: number;
        avgCost?: number;
        totalRequests: number;
      }
      const actualOptimized: OptimizedStats = actualStats[0] ?? {
        avgInputTokens: 150,
        avgOutputTokens: 50,
        avgTotalTokens: 200,
        avgCost: 0.0003,
        totalRequests: 0
      };

      // Calculate traditional (unoptimized) metrics
      // Traditional approach: Full image transmission (2 images at ~2000 tokens each) + prompt + JSON output
      const traditionalInputTokens = 4000; // 2 images at ~2000 tokens each
      const traditionalOutputTokens = 400; // JSON response
      const traditionalTotalTokens = traditionalInputTokens + traditionalOutputTokens;
      const traditionalCost = (traditionalInputTokens / 1_000_000) * inputPricePer1M + 
                             (traditionalOutputTokens / 1_000_000) * outputPricePer1M;

      // Calculate savings
      const tokenReduction = actualOptimized.totalRequests > 0 && actualOptimized.avgTotalTokens
        ? ((1 - actualOptimized.avgTotalTokens / traditionalTotalTokens) * 100)
        : 95.1; // Default if no data
      const costReduction = actualOptimized.totalRequests > 0 && actualOptimized.avgCost
        ? ((1 - actualOptimized.avgCost / traditionalCost) * 100)
        : 93.0; // Default if no data

      // Calculate breakdown based on optimization techniques
      // Feature extraction reduces image tokens by ~90%
      // TOON encoding reduces feature representation by ~40%
      // Cortex output reduces response tokens by ~87%
      const featureExtractionReduction = 90;
      const toonEncodingReduction = 40;
      const cortexOutputReduction = 87;

      return res.status(200).json({
        success: true,
        comparison: {
          traditional: {
            inputTokens: traditionalInputTokens,
            outputTokens: traditionalOutputTokens,
            totalTokens: traditionalTotalTokens,
            cost: parseFloat(traditionalCost.toFixed(6)),
            description: 'Full image transmission with JSON output (baseline)'
          },
          optimized: {
            inputTokens: Math.round(actualOptimized.avgInputTokens ?? 150),
            outputTokens: Math.round(actualOptimized.avgOutputTokens ?? 50),
            totalTokens: Math.round(actualOptimized.avgTotalTokens ?? 200),
            cost: parseFloat((actualOptimized.avgCost ?? 0.0003).toFixed(6)),
            description: 'Feature extraction + TOON + Cortex LISP (actual usage)'
          },
          savings: {
            tokenReduction: parseFloat(tokenReduction.toFixed(1)),
            costReduction: parseFloat(costReduction.toFixed(1)),
            technique: 'feature_extraction_toon_cortex',
            basedOnRequests: actualOptimized.totalRequests
          },
          breakdown: {
            featureExtraction: {
              reduction: featureExtractionReduction,
              description: 'Extract visual features instead of raw pixels'
            },
            toonEncoding: {
              reduction: toonEncodingReduction,
              description: 'Encode features as TOON format'
            },
            cortexOutput: {
              reduction: cortexOutputReduction,
              description: 'Use Cortex LISP for structured output'
            }
          },
          metadata: {
            dataSource: actualOptimized.totalRequests > 0 ? 'real_usage' : 'estimated',
            sampleSize: actualOptimized.totalRequests,
            lastUpdated: new Date().toISOString()
          }
        }
      });
    } catch (error) {
      loggingService.error('Failed to get cost comparison', {
        error: error instanceof Error ? error.message : String(error)
      });

      // Fallback to estimated values if database query fails
      const traditionalInputTokens = 4000;
      const traditionalOutputTokens = 400;
      const traditionalTotalTokens = 4400;
      const traditionalCost = (traditionalInputTokens / 1_000_000) * 0.80 + 
                             (traditionalOutputTokens / 1_000_000) * 3.20;

      const optimizedInputTokens = 150;
      const optimizedOutputTokens = 50;
      const optimizedTotalTokens = 200;
      const optimizedCost = (optimizedInputTokens / 1_000_000) * 0.80 + 
                           (optimizedOutputTokens / 1_000_000) * 3.20;

      return res.status(200).json({
        success: true,
        comparison: {
          traditional: {
            inputTokens: traditionalInputTokens,
            outputTokens: traditionalOutputTokens,
            totalTokens: traditionalTotalTokens,
            cost: parseFloat(traditionalCost.toFixed(6)),
            description: 'Full image transmission with JSON output (estimated)'
          },
          optimized: {
            inputTokens: optimizedInputTokens,
            outputTokens: optimizedOutputTokens,
            totalTokens: optimizedTotalTokens,
            cost: parseFloat(optimizedCost.toFixed(6)),
            description: 'Feature extraction + TOON + Cortex LISP (estimated)'
          },
          savings: {
            tokenReduction: 95.5,
            costReduction: 93.0,
            technique: 'feature_extraction_toon_cortex'
          },
          breakdown: {
            featureExtraction: {
              reduction: 90,
              description: 'Extract visual features instead of raw pixels'
            },
            toonEncoding: {
              reduction: 40,
              description: 'Encode features as TOON format'
            },
            cortexOutput: {
              reduction: 87,
              description: 'Use Cortex LISP for structured output'
            }
          },
          metadata: {
            dataSource: 'estimated',
            sampleSize: 0,
            lastUpdated: new Date().toISOString(),
            note: 'Using estimated values due to database query error'
          }
        }
      });
    }
  }
}

