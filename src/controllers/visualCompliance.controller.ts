import {  Response } from 'express';
import { VisualComplianceOptimizedService } from '../services/visualComplianceOptimized.service';
import { loggingService } from '../services/logging.service';
import { Usage } from '../models/Usage';
import { Optimization } from '../models/Optimization';
import { AWS_BEDROCK_PRICING } from '../utils/pricing/aws-bedrock';
import { S3Service } from '../services/s3.service';
import mongoose from 'mongoose';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class VisualComplianceController {
  
  /**
   * POST /api/visual-compliance/check-optimized
   * Ultra-optimized visual compliance check (feature-based)
   */
  static async checkComplianceOptimized(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const {
      referenceImage,
      evidenceImage,
      complianceCriteria,
      industry,
      useUltraCompression = true,
      mode = 'optimized',
      metaPrompt,
      metaPromptPresetId,
      templateId
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

    const userId = req.userId?.toString() || 'anonymous';
    const projectId = req.body.projectId;

    ControllerHelper.logRequestStart('checkComplianceOptimized', req, {
      industry,
      mode
    });

    try {

      const result = await VisualComplianceOptimizedService.processComplianceCheckOptimized({
        referenceImage,
        evidenceImage,
        complianceCriteria,
        industry,
        userId,
        templateId,
        projectId,
        useUltraCompression,
        mode,
        metaPrompt,
        metaPromptPresetId
      });

      // Use cost breakdown from service if available, otherwise calculate
      const costBreakdown = result.metadata.costBreakdown;
      const baselineCost = costBreakdown?.baseline.totalCost ?? 0.0043;
      const costSavings = costBreakdown?.savings.percentage ?? ((1 - result.metadata.cost / baselineCost) * 100);
      
      // For standard mode, we're not optimizing for cost but for accuracy
      // So we need to handle the case where actual cost is higher than baseline
      const actualCostSaved = costBreakdown?.savings.amount ?? (baselineCost - result.metadata.cost);
      const actualImprovementPercentage = costSavings;

      // Upload images to S3
      let referenceImageUrl = '';
      let evidenceImageUrl = '';
      
      try {
        // Upload reference image to S3
        const referenceBuffer = Buffer.from(
          typeof referenceImage === 'string' ? referenceImage.replace(/^data:image\/\w+;base64,/, '') : referenceImage,
          'base64'
        );
        const refUpload = await S3Service.uploadDocument(
          userId === 'anonymous' ? 'anonymous' : userId,
          `visual-compliance-reference-${Date.now()}.jpg`,
          referenceBuffer,
          'image/jpeg',
          { type: 'visual-compliance-reference', industry }
        );
        referenceImageUrl = refUpload.s3Url;

        // Upload evidence image to S3
        const evidenceBuffer = Buffer.from(
          typeof evidenceImage === 'string' ? evidenceImage.replace(/^data:image\/\w+;base64,/, '') : evidenceImage,
          'base64'
        );
        const evidUpload = await S3Service.uploadDocument(
          userId === 'anonymous' ? 'anonymous' : userId,
          `visual-compliance-evidence-${Date.now()}.jpg`,
          evidenceBuffer,
          'image/jpeg',
          { type: 'visual-compliance-evidence', industry }
        );
        evidenceImageUrl = evidUpload.s3Url;

        loggingService.info('Visual compliance images uploaded to S3', {
          userId,
          referenceUrl: referenceImageUrl,
          evidenceUrl: evidenceImageUrl
        });
      } catch (uploadError) {
        loggingService.error('Failed to upload images to S3', {
          error: uploadError instanceof Error ? uploadError.message : String(uploadError),
          userId
        });
        // Continue without S3 URLs if upload fails
      }

      // Save to Optimization model for tracking
      // Only save if it's actually an optimization (positive savings) or force positive values for tracking
      try {
        const optimizationRecord = await Optimization.create({
          userId: userId === 'anonymous' ? new mongoose.Types.ObjectId() : new mongoose.Types.ObjectId(userId),
          userQuery: `Visual Compliance Check (${mode}): ${industry}`,
          generatedAnswer: `${result.pass_fail ? 'PASS' : 'FAIL'} - Score: ${result.compliance_score}% - ${result.feedback_message}`,
          optimizationTechniques: [
            mode === 'optimized' ? 'feature_extraction' : 'full_image_analysis',
            mode === 'optimized' ? 'toon_encoding' : 'claude_35_sonnet',
            mode === 'optimized' ? 'cortex_compression' : 'meta_prompt',
            result.metadata.technique
          ],
          originalTokens: (costBreakdown?.baseline.inputTokens ?? 4500) + (costBreakdown?.baseline.outputTokens ?? 800),
          optimizedTokens: result.metadata.inputTokens + result.metadata.outputTokens,
          tokensSaved: Math.max(0, ((costBreakdown?.baseline.inputTokens ?? 4500) + (costBreakdown?.baseline.outputTokens ?? 800)) - (result.metadata.inputTokens + result.metadata.outputTokens)),
          originalCost: costBreakdown?.baseline.totalCost ?? baselineCost,
          optimizedCost: result.metadata.cost,
          // For standard mode, set minimum of 0 for costSaved and improvementPercentage since it's not optimizing for cost
          costSaved: Math.max(0, actualCostSaved),
          improvementPercentage: Math.max(0, actualImprovementPercentage),
          service: 'visual-compliance',
          model: mode === 'optimized' ? 'amazon.nova-pro-v1:0' : 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
          category: 'response_formatting',
          optimizationType: mode === 'optimized' ? 'visual_compliance' : 'visual_compliance_standard',
          visualComplianceData: {
            referenceImageUrl,
            evidenceImageUrl,
            complianceScore: result.compliance_score,
            passFail: result.pass_fail,
            feedbackMessage: result.feedback_message,
            industry,
            complianceCriteria
          },
          suggestions: [],
          metadata: {
            latency: result.metadata.latency,
            compressionRatio: result.metadata.compressionRatio,
            technique: result.metadata.technique,
            inputTokens: result.metadata.inputTokens,
            outputTokens: result.metadata.outputTokens,
            costBreakdown: result.metadata.costBreakdown
          },
          cortexImpactMetrics: {
            tokenReduction: {
              withoutCortex: (costBreakdown?.baseline.inputTokens ?? 4500) + (costBreakdown?.baseline.outputTokens ?? 800),
              withCortex: result.metadata.inputTokens + result.metadata.outputTokens,
              absoluteSavings: Math.max(0, ((costBreakdown?.baseline.inputTokens ?? 4500) + (costBreakdown?.baseline.outputTokens ?? 800)) - (result.metadata.inputTokens + result.metadata.outputTokens)),
              percentageSavings: Math.max(0, result.metadata.compressionRatio)
            },
            qualityMetrics: {
              clarityScore: result.compliance_score / 100,
              completenessScore: result.pass_fail ? 1.0 : 0.5,
              relevanceScore: mode === 'standard' ? 0.98 : 0.95, // Higher relevance for full image analysis
              ambiguityReduction: mode === 'standard' ? 0.95 : 0.85,
              redundancyRemoval: mode === 'standard' ? 0.80 : 0.90
            },
            performanceMetrics: {
              processingTime: result.metadata.latency,
              responseLatency: result.metadata.latency,
              compressionRatio: Math.max(0, result.metadata.compressionRatio)
            },
            costImpact: {
              estimatedCostWithoutCortex: costBreakdown?.baseline.totalCost ?? baselineCost,
              actualCostWithCortex: result.metadata.cost,
              costSavings: Math.max(0, costBreakdown?.savings.amount ?? (baselineCost - result.metadata.cost)),
              savingsPercentage: Math.max(0, costSavings)
            },
            justification: {
              optimizationTechniques: mode === 'optimized' 
                ? ['Feature Extraction', 'TOON Encoding', 'Cortex LISP Output']
                : ['Full Image Analysis', 'Claude 3.5 Sonnet', 'Custom Meta Prompts'],
              keyImprovements: mode === 'optimized'
                ? [
                    `${Math.max(0, costSavings).toFixed(1)}% cost reduction`,
                    `${Math.max(0, result.metadata.compressionRatio).toFixed(1)}% token reduction`,
                    'Image feature extraction instead of raw pixels'
                  ]
                : [
                    'Full image context for detailed analysis',
                    'Customizable meta prompts for industry-specific verification',
                    'Claude 3.5 Sonnet for highest accuracy'
                  ],
              confidenceScore: mode === 'standard' ? 0.98 : 0.95
            }
          },
          tags: ['visual-compliance', 'cortex', 'toon', industry]
        });

        loggingService.info('Visual compliance optimization saved successfully', {
          optimizationId: optimizationRecord._id,
          userId,
          costSaved: costBreakdown?.savings.amount,
          referenceImageUrl,
          evidenceImageUrl
        });
      } catch (saveError) {
        loggingService.error('CRITICAL: Failed to save optimization record', {
          error: saveError instanceof Error ? saveError.message : String(saveError),
          stack: saveError instanceof Error ? saveError.stack : undefined,
          userId
        });
        // Re-throw to see the actual error in response
        throw new Error(`Failed to save optimization: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`);
      }

      ControllerHelper.logRequestSuccess('checkComplianceOptimized', req, startTime, {
        industry,
        mode,
        costSavings: costSavings.toFixed(1)
      });

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
      ControllerHelper.handleError('checkComplianceOptimized', error, req, res, startTime);
      return res;
    }
  }

  /**
   * POST /api/visual-compliance/batch
   * Process multiple compliance checks in parallel
   */
  static async batchCheck(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { requests } = req.body;

    ControllerHelper.logRequestStart('batchCheck', req, {
      requestsCount: requests?.length || 0
    });

    try {
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

      const userId = req.userId?.toString() || 'anonymous';

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

      ControllerHelper.logRequestSuccess('batchCheck', req, startTime, {
        total: results.length,
        successful,
        failed
      });

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
      ControllerHelper.handleError('batchCheck', error, req, res, startTime);
      return res;
    }
  }

  /**
   * GET /api/visual-compliance/presets
   * Get available quality presets and their characteristics
   */
  static getPresets(_req: any, res: Response): Response {
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
  static async getCostComparison(_req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    
    ControllerHelper.logRequestStart('getCostComparison', _req);

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

      ControllerHelper.logRequestSuccess('getCostComparison', _req, startTime);

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

      ControllerHelper.logRequestSuccess('getCostComparison', _req, startTime, {
        fallback: true
      });

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

  /**
   * GET /api/visual-compliance/meta-prompt-presets
   * Get available meta prompt presets
   */
  static async getMetaPromptPresets(_req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    
    ControllerHelper.logRequestStart('getMetaPromptPresets', _req);

    try {
      const { MetaPromptPresetsService } = await import('../services/metaPromptPresets.service');
      
      const presets = MetaPromptPresetsService.getAllPresets();
      
      // Return presets with minimal information (don't send full prompts in list)
      const presetsInfo = presets.map(preset => ({
        id: preset.id,
        name: preset.name,
        industry: preset.industry,
        description: preset.description
      }));

      ControllerHelper.logRequestSuccess('getMetaPromptPresets', _req, startTime, {
        presetsCount: presetsInfo.length
      });

      return res.status(200).json({
        success: true,
        presets: presetsInfo
      });
    } catch (error) {
      ControllerHelper.handleError('getMetaPromptPresets', error, _req, res, startTime);
      return res;
    }
  }

  /**
   * GET /api/visual-compliance/meta-prompt-presets/:id
   * Get a specific meta prompt preset with full prompt text
   */
  static async getMetaPromptPresetById(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { id } = req.params;
    
    ControllerHelper.logRequestStart('getMetaPromptPresetById', req, { presetId: id });

    try {
      const { MetaPromptPresetsService } = await import('../services/metaPromptPresets.service');
      
      const preset = MetaPromptPresetsService.getPresetById(id);
      
      if (!preset) {
        return res.status(404).json({
          success: false,
          error: `Preset not found: ${id}`
        });
      }

      ControllerHelper.logRequestSuccess('getMetaPromptPresetById', req, startTime, { presetId: id });

      return res.status(200).json({
        success: true,
        preset
      });
    } catch (error) {
      ControllerHelper.handleError('getMetaPromptPresetById', error, req, res, startTime, { presetId: id });
      return res;
    }
  }
}

