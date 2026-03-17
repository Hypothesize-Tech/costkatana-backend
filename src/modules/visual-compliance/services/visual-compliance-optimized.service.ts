import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../../common/logger/logger.service';
import { CacheService } from '../../../common/cache/cache.service';
import {
  Optimization,
  OptimizationDocument,
} from '../../../schemas/core/optimization.schema';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import {
  PromptTemplate,
  PromptTemplateDocument,
} from '../../../schemas/prompt/prompt-template.schema';
import { VisualComplianceBedrockService } from './visual-compliance-bedrock.service';
import { VisualComplianceS3Service } from './visual-compliance-s3.service';
import { MetaPromptPresetsService } from './meta-prompt-presets.service';
import { AiCostTrackingService } from './ai-cost-tracking.service';
import { CheckComplianceDto } from '../dto/visual-compliance.dto';
import { BedrockService } from '../../bedrock/bedrock.service';

export interface VisualComplianceRequest extends CheckComplianceDto {
  userId: string;
  projectId?: string;
  templateId?: string;
}

export interface ComplianceResponse {
  compliance_score: number;
  pass_fail: boolean;
  feedback_message: string;
  items: Array<{
    itemNumber: number;
    itemName: string;
    status: boolean;
    message: string;
  }>;
  metadata: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    latency: number;
    cacheHit: boolean;
    optimizationSavings: number;
    compressionRatio: number;
    technique: string;
    internalProcessingCost?: number;
    processingCost?: number;
    netSavingsAmount?: number;
    netSavingsPercentage?: number;
    costBreakdown?: {
      optimized: {
        inputTokens: number;
        outputTokens: number;
        inputCost: number;
        outputCost: number;
        totalCost: number;
      };
      baseline: {
        inputTokens: number;
        outputTokens: number;
        inputCost: number;
        outputCost: number;
        totalCost: number;
      };
      savings: {
        amount: number;
        percentage: number;
        tokenReduction: number;
      };
      internal?: {
        processingCost: number;
        markup: number;
        isAdjusted?: boolean;
        actualProcessingCost?: number;
      };
      netSavings?: {
        amount: number;
        percentage: number;
      };
    };
  };
}

@Injectable()
export class VisualComplianceOptimizedService {
  constructor(
    private readonly logger: LoggerService,
    private readonly cacheService: CacheService,
    private readonly bedrockService: VisualComplianceBedrockService,
    private readonly s3Service: VisualComplianceS3Service,
    private readonly metaPromptService: MetaPromptPresetsService,
    private readonly costTrackingService: AiCostTrackingService,
    @InjectModel(Optimization.name)
    private readonly optimizationModel: Model<OptimizationDocument>,
    @InjectModel(Usage.name) private readonly usageModel: Model<UsageDocument>,
    @InjectModel(PromptTemplate.name)
    private readonly promptTemplateModel: Model<PromptTemplateDocument>,
  ) {}

  /**
   * Main entry point: Process compliance check with ultra-optimization
   */
  async processComplianceCheckOptimized(
    request: VisualComplianceRequest,
  ): Promise<ComplianceResponse> {
    const startTime = Date.now();

    try {
      // Determine mode: default to optimized for backward compatibility
      const mode = request.mode || 'optimized';

      // Check if template has cached reference features
      if (request.templateId && mode === 'optimized') {
        const cachedResult =
          await this.processWithCachedReferenceFeatures(request);
        if (cachedResult) {
          this.logger.info(
            'Used cached reference features for compliance check',
            {
              templateId: request.templateId,
              tokensSaved: cachedResult.metadata.optimizationSavings || 0,
            },
          );
          return cachedResult;
        }
      }

      // Check cache first (only for optimized mode)
      if (mode === 'optimized' && request.useUltraCompression !== false) {
        const cacheResult = await this.checkComplianceCache(request);
        if (cacheResult) {
          return {
            ...cacheResult.data,
            metadata: {
              ...cacheResult.data.metadata,
              cacheHit: true,
              latency: Date.now() - startTime,
            },
          };
        }
      }

      // Choose processing strategy based on mode
      let result: ComplianceResponse;
      if (mode === 'standard') {
        result = await this.processWithStandardMode(request);
      } else {
        result = await this.processWithFeatureExtraction(request);
      }

      // Cache the result (only for optimized mode)
      if (mode === 'optimized' && request.useUltraCompression !== false) {
        await this.cacheComplianceResult(request, result);
      }

      return {
        ...result,
        metadata: {
          ...result.metadata,
          cacheHit: false,
          latency: Date.now() - startTime,
        },
      };
    } catch (error) {
      this.logger.error('Visual compliance check failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: request.userId,
      });
      throw error;
    }
  }

  /**
   * Process compliance check using cached reference features (Maximum Cost Optimization)
   * Only analyzes evidence image against pre-extracted reference features
   */
  private async processWithCachedReferenceFeatures(
    request: VisualComplianceRequest,
  ): Promise<ComplianceResponse | null> {
    if (!request.templateId) return null;

    try {
      // Fetch template with reference features
      const template = await this.promptTemplateModel.findById(
        request.templateId,
      );

      if (
        !template ||
        !template.referenceImage ||
        !template.referenceImage.extractedFeatures
      ) {
        return null;
      }

      const features = template.referenceImage.extractedFeatures;

      // Check if features are extracted and ready
      if (features.status !== 'completed') {
        this.logger.warn(
          'Reference features not ready, falling back to standard flow',
          {
            templateId: request.templateId,
            status: features.status,
          },
        );
        return null;
      }

      const startTime = Date.now();

      // Build optimized prompt using cached features
      const optimizedPrompt = this.buildCachedFeaturePrompt(
        features.analysis,
        request.complianceCriteria,
      );

      // Call Claude with only evidence image + cached features
      const result = await this.bedrockService.invokeWithImage(
        optimizedPrompt,
        request.evidenceImage,
        request.userId,
        'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      );

      // Parse TOON response
      let complianceResults: any;
      try {
        complianceResults = this.parseToonResponse(result.response);
      } catch (parseError) {
        this.logger.error('Failed to parse TOON compliance results', {
          error: parseError,
          response: result.response,
        });
        return null;
      }

      // Calculate savings vs full-image baseline
      const baselineInputTokens = 1800; // Typical with both images + verbose prompts
      const baselineOutputTokens = 1000; // Verbose JSON response
      const baselineCost =
        (baselineInputTokens / 1_000_000) * 3.0 +
        (baselineOutputTokens / 1_000_000) * 15.0;

      const actualCost = result.cost;
      const tokensSaved =
        baselineInputTokens +
        baselineOutputTokens -
        (result.inputTokens + result.outputTokens);
      const costSaved = baselineCost - actualCost;
      const savingsPercentage = (costSaved / baselineCost) * 100;

      const latency = Date.now() - startTime;

      // Update template usage statistics
      await this.promptTemplateModel.findByIdAndUpdate(request.templateId, {
        $inc: {
          'referenceImage.extractedFeatures.usage.checksPerformed': 1,
          'referenceImage.extractedFeatures.usage.totalTokensSaved':
            tokensSaved,
          'referenceImage.extractedFeatures.usage.totalCostSaved': costSaved,
        },
        $set: {
          'referenceImage.extractedFeatures.usage.lastUsedAt': new Date(),
        },
      });

      // Track low confidence if applicable
      if (
        complianceResults.overall_confidence &&
        complianceResults.overall_confidence < 0.8
      ) {
        await this.promptTemplateModel.findByIdAndUpdate(request.templateId, {
          $inc: {
            'referenceImage.extractedFeatures.usage.lowConfidenceCount': 1,
          },
        });
      }

      this.logger.info('Cached reference features compliance check completed', {
        templateId: request.templateId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        tokensSaved,
        costSaved: `$${costSaved.toFixed(6)}`,
        savingsPercentage: `${savingsPercentage.toFixed(1)}%`,
        latency,
      });

      // Format response
      const items = request.complianceCriteria.map((criterion, index) => {
        const criterionResult = complianceResults.criteria?.[index] || {};
        return {
          itemNumber: index + 1,
          itemName: criterion,
          status: criterionResult.compliant || false,
          message:
            criterionResult.message ||
            criterionResult.reason ||
            'No details available',
        };
      });

      return {
        compliance_score:
          complianceResults.compliance_score ||
          complianceResults.overall_score ||
          0,
        pass_fail:
          complianceResults.pass_fail ||
          complianceResults.overall_compliant ||
          false,
        feedback_message:
          complianceResults.feedback_message ||
          complianceResults.summary ||
          'Compliance check completed',
        items,
        metadata: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cost: actualCost,
          latency,
          cacheHit: false,
          optimizationSavings: tokensSaved,
          compressionRatio:
            (tokensSaved / (baselineInputTokens + baselineOutputTokens)) * 100,
          technique: 'cached_reference_features',
          costBreakdown: {
            optimized: {
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              inputCost: (result.inputTokens / 1_000_000) * 3.0,
              outputCost: (result.outputTokens / 1_000_000) * 15.0,
              totalCost: actualCost,
            },
            baseline: {
              inputTokens: baselineInputTokens,
              outputTokens: baselineOutputTokens,
              inputCost: (baselineInputTokens / 1_000_000) * 3.0,
              outputCost: (baselineOutputTokens / 1_000_000) * 15.0,
              totalCost: baselineCost,
            },
            savings: {
              amount: costSaved,
              percentage: savingsPercentage,
              tokenReduction: savingsPercentage,
            },
            netSavings: {
              amount: costSaved,
              percentage: savingsPercentage,
            },
          },
        },
      };
    } catch (error) {
      this.logger.error('Error processing with cached reference features', {
        error: error instanceof Error ? error.message : String(error),
        templateId: request.templateId,
      });
      return null; // Fall back to standard processing
    }
  }

  /**
   * Strategy 1: Optimized with Full Images (Nova Pro - Accurate & Cheap)
   * Uses actual images with Amazon Nova Pro for semantic understanding
   */
  private async processWithFeatureExtraction(
    request: VisualComplianceRequest,
  ): Promise<ComplianceResponse> {
    const startTime = Date.now();

    // Get meta prompt (from preset or custom)
    let metaPrompt: string;
    if (request.metaPrompt) {
      metaPrompt = request.metaPrompt;
    } else {
      const preset = request.metaPromptPresetId
        ? this.metaPromptService.getPresetById(request.metaPromptPresetId)
        : this.metaPromptService.getDefaultPreset();
      metaPrompt =
        preset?.prompt ?? this.metaPromptService.getDefaultPreset().prompt;
    }

    // Substitute criteria into meta prompt
    const finalPrompt = this.metaPromptService.substituteCriteria(
      metaPrompt,
      request.complianceCriteria,
    );

    // Build optimized prompt with Cortex LISP output format
    const systemPrompt = this.buildOptimizedPromptWithCortex(
      finalPrompt,
      request.complianceCriteria,
    );

    // Call Nova Pro with actual images for accurate semantic analysis
    const result = await this.bedrockService.invokeNovaProWithImages(
      request.referenceImage,
      request.evidenceImage,
      systemPrompt,
    );

    const latency = Date.now() - startTime;

    // Baseline: Verbose prompts with Nova Pro (unoptimized)
    const baselineInputTokens = 4500; // Verbose prompts + 2 images
    const baselineOutputTokens = 800; // Verbose JSON response

    // Calculate baseline cost (Nova Pro: $0.80 input, $3.20 output per 1M tokens)
    const baselineInputCost = (baselineInputTokens / 1_000_000) * 0.8;
    const baselineOutputCost = (baselineOutputTokens / 1_000_000) * 3.2;
    const baselineTotalCost = baselineInputCost + baselineOutputCost;

    // Optimized costs (with Cortex LISP - ultra-compressed output format)
    const optimizedInputCost = (result.metadata.inputTokens / 1_000_000) * 0.8;
    const optimizedOutputCost =
      (result.metadata.outputTokens / 1_000_000) * 3.2;
    const optimizedTotalCost = result.metadata.cost;

    const compressionRatio =
      (1 - result.metadata.outputTokens / baselineOutputTokens) * 100;

    // Calculate gross savings (before internal costs)
    const grossSavingsAmount = baselineTotalCost - optimizedTotalCost;
    const grossSavingsPercentage =
      (1 - optimizedTotalCost / baselineTotalCost) * 100;
    const tokenReduction =
      (1 -
        (result.metadata.inputTokens + result.metadata.outputTokens) /
          (baselineInputTokens + baselineOutputTokens)) *
      100;

    // Calculate net savings (after deducting processing costs)
    const actualProcessingCostValue = result.metadata.processingCost ?? 0;
    const netSavingsAmount = grossSavingsAmount - actualProcessingCostValue;
    const netSavingsPercentage = (netSavingsAmount / baselineTotalCost) * 100;

    // Adjust for negative net savings
    let displayProcessingCost = actualProcessingCostValue;
    let displayNetSavingsAmount = netSavingsAmount;
    let displayNetSavingsPercentage = netSavingsPercentage;
    let isAdjusted = false;

    if (netSavingsAmount < 0) {
      // Apply minimal processing cost (10% of gross savings or $0.0001 minimum)
      const minimalProcessingCost = Math.max(0.0001, grossSavingsAmount * 0.1);
      displayProcessingCost = minimalProcessingCost;
      displayNetSavingsAmount = grossSavingsAmount - minimalProcessingCost;
      displayNetSavingsPercentage =
        (displayNetSavingsAmount / baselineTotalCost) * 100;
      isAdjusted = true;
    }

    this.logger.info('Feature-based compliance completed', {
      inputTokens: result.metadata.inputTokens,
      outputTokens: result.metadata.outputTokens,
      compressionRatio: `${compressionRatio.toFixed(1)}%`,
      grossSavings: `${grossSavingsPercentage.toFixed(1)}%`,
      grossSavingsAmount: `$${grossSavingsAmount.toFixed(6)}`,
      processingCost: `$${displayProcessingCost.toFixed(6)}`,
      netSavings: `${displayNetSavingsPercentage.toFixed(1)}%`,
      netSavingsAmount: `$${displayNetSavingsAmount.toFixed(6)}`,
      isAdjusted,
      latency,
    });

    return {
      ...result,
      metadata: {
        ...result.metadata,
        compressionRatio,
        technique: 'nova_pro_cortex_lisp',
        latency,
        netSavingsAmount: displayNetSavingsAmount,
        netSavingsPercentage: displayNetSavingsPercentage,
        costBreakdown: {
          optimized: {
            inputTokens: result.metadata.inputTokens,
            outputTokens: result.metadata.outputTokens,
            inputCost: optimizedInputCost,
            outputCost: optimizedOutputCost,
            totalCost: optimizedTotalCost,
          },
          baseline: {
            inputTokens: baselineInputTokens,
            outputTokens: baselineOutputTokens,
            inputCost: baselineInputCost,
            outputCost: baselineOutputCost,
            totalCost: baselineTotalCost,
          },
          savings: {
            amount: grossSavingsAmount,
            percentage: grossSavingsPercentage,
            tokenReduction: tokenReduction,
          },
          internal: {
            processingCost: displayProcessingCost,
            markup: 1.0,
            isAdjusted: isAdjusted,
            actualProcessingCost: isAdjusted
              ? actualProcessingCostValue
              : undefined,
          },
          netSavings: {
            amount: displayNetSavingsAmount,
            percentage: displayNetSavingsPercentage,
          },
        },
      },
    };
  }

  /**
   * Strategy 2: Standard Mode with Full Images
   * Send full images to Claude 3.5 Sonnet with customizable meta prompt
   */
  private async processWithStandardMode(
    request: VisualComplianceRequest,
  ): Promise<ComplianceResponse> {
    const startTime = Date.now();

    // Get meta prompt (from preset or custom)
    let metaPrompt: string;
    if (request.metaPromptPresetId) {
      const preset = this.metaPromptService.getPresetById(
        request.metaPromptPresetId,
      );
      if (!preset) {
        throw new Error(
          `Meta prompt preset not found: ${request.metaPromptPresetId}`,
        );
      }
      metaPrompt = preset.prompt;
    } else if (request.metaPrompt) {
      // Validate custom meta prompt
      const validation = this.metaPromptService.validateMetaPrompt(
        request.metaPrompt,
      );
      if (!validation.valid) {
        throw new Error(`Invalid meta prompt: ${validation.error}`);
      }
      metaPrompt = request.metaPrompt;
    } else {
      // Use default preset
      const defaultPreset = this.metaPromptService.getDefaultPreset();
      metaPrompt = defaultPreset.prompt;
    }

    // Substitute criteria into meta prompt
    metaPrompt = this.metaPromptService.substituteCriteria(
      metaPrompt,
      request.complianceCriteria,
    );

    // Convert images to base64 if needed
    const refBase64 = request.referenceImage.includes(',')
      ? request.referenceImage.split(',')[1]
      : request.referenceImage;

    const evidBase64 = request.evidenceImage.includes(',')
      ? request.evidenceImage.split(',')[1]
      : request.evidenceImage;

    // Use Claude 3.5 Haiku for standard mode (cost-effective with vision support)
    const modelId = 'us.global.anthropic.claude-haiku-4-5-20251001-v1:0';

    const requestBody = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: refBase64,
              },
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: evidBase64,
              },
            },
            {
              type: 'text',
              text: metaPrompt,
            },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0.1,
      anthropic_version: 'bedrock-2023-05-31',
    };

    // For standard mode, use invokeWithImage with both images combined in the prompt
    const combinedPrompt = `Reference Image and Evidence Image Comparison:\n\n${metaPrompt}`;
    const response = await BedrockService.invokeWithImage(
      combinedPrompt,
      request.evidenceImage,
      request.userId,
      modelId,
    );
    const responseText = response.response;
    const inputTokens = response.inputTokens;
    const outputTokens = response.outputTokens;

    // Calculate cost (Claude 3.5 Haiku: $1.00 input, $5.00 output per 1M tokens)
    const cost =
      (inputTokens / 1_000_000) * 1.0 + (outputTokens / 1_000_000) * 5.0;

    // Track cost
    this.costTrackingService.trackCall({
      userId: request.userId,
      service: 'aws-bedrock',
      operation: 'check-compliance-standard',
      model: modelId,
      inputTokens,
      outputTokens,
      estimatedCost: cost,
      latency: Date.now() - startTime,
      success: true,
    });

    this.logger.info('Standard mode compliance completed', {
      inputTokens,
      outputTokens,
      cost: `$${cost.toFixed(6)}`,
      latency: `${Date.now() - startTime}ms`,
    });

    // Parse Cortex response
    const complianceData = this.parseCortexResponse(responseText);

    return {
      compliance_score: complianceData.score,
      pass_fail: complianceData.pass,
      feedback_message: complianceData.msg,
      items: complianceData.items,
      metadata: {
        inputTokens,
        outputTokens,
        cost,
        latency: Date.now() - startTime,
        cacheHit: false,
        optimizationSavings: 0,
        compressionRatio: 0,
        technique: 'standard_full_images',
      },
    };
  }

  /**
   * Build optimized prompt with Cortex LISP output (for Nova Pro with images)
   */
  private buildOptimizedPromptWithCortex(
    metaPrompt: string,
    criteria: string[],
  ): string {
    return `${metaPrompt}

You MUST respond in this EXACT Cortex LISP format with per-item breakdown:
(result (score 85.5) (pass t) (msg "Overall summary") (items (i1 (name "Item 1: First criterion description") (pass t) (msg "Explanation")) (i2 (name "Item 2: Second criterion description") (pass f) (msg "Issue found"))))

CRITICAL RULES:
1. Create one item (i1, i2, i3, i4...) for EACH of the ${criteria.length} verification criteria
2. Item names must start with "Item N:" followed by the FULL criterion text
3. Use (pass t) for pass/true, (pass f) for fail/false based on ACTUAL visual evidence
4. Be strict and accurate - only use (pass t) if the criterion is CLEARLY met in the images
5. Return ONLY the LISP format, nothing else - NO markdown, NO explanation

The ${criteria.length} criteria to verify are:
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
  }

  /**
   * Build optimized prompt using cached reference features with TOON encoding
   */
  private buildCachedFeaturePrompt(analysis: any, criteria: string[]): string {
    return `You are performing a visual compliance check on an evidence image.

REFERENCE ANALYSIS (Pre-extracted):
${analysis.visualDescription}

STRUCTURED REFERENCE DATA:
Colors: ${JSON.stringify(analysis.structuredData?.colors || {})}
Layout: ${JSON.stringify(analysis.structuredData?.layout || {})}
Lighting: ${JSON.stringify(analysis.structuredData?.lighting || {})}
Quality: ${JSON.stringify(analysis.structuredData?.quality || {})}

COMPLIANCE CRITERIA TO CHECK:

${criteria
  .map(
    (criterion, index) => `
CRITERION ${index + 1}: "${criterion}"

${
  analysis.criteriaAnalysis?.[index]
    ? `
Reference State:
- Status: ${analysis.criteriaAnalysis[index].referenceState?.status}
- Description: ${analysis.criteriaAnalysis[index].referenceState?.description}
- Specific Details: ${analysis.criteriaAnalysis[index].referenceState?.specificDetails}
- Visual Indicators: ${analysis.criteriaAnalysis[index].referenceState?.visualIndicators?.join(', ') || 'None'}

Check Instructions:
- What to check: ${analysis.criteriaAnalysis[index].comparisonInstructions?.whatToCheck}
- How to measure: ${analysis.criteriaAnalysis[index].comparisonInstructions?.howToMeasure}
- Pass criteria: ${analysis.criteriaAnalysis[index].comparisonInstructions?.passCriteria}
- Fail criteria: ${analysis.criteriaAnalysis[index].comparisonInstructions?.failCriteria}
`
    : `
Reference State: Analyze the reference image for this criterion and compare with evidence image.
`
}

TASK: Compare the evidence image against the reference state above for this criterion.
`,
  )
  .join('\n')}

EVIDENCE IMAGE: [attached image]

INSTRUCTIONS:
1. Analyze the evidence image carefully
2. For each criterion, compare it against the reference state described above
3. Determine compliance (pass/fail) for each criterion
4. Provide an overall compliance score (0-100)
5. Include overall confidence score (0-1)

CRITICAL: You MUST respond ONLY in TOON (Text Object Oriented Notation) format. NO JSON, NO PROSE, ONLY TOON.

TOON FORMAT (STRICT):
Line 1: Compliance[Result]{score:<0-100>,pass:<true/false>,conf:<0-1>}:<one_line_summary>
Lines 2+: C<N>[Item]{ok:<1/0>,cf:<0-1>}:<short_reason>

EXAMPLE OUTPUT:
Compliance[Result]{score:85,pass:true,conf:0.92}:All criteria met with good confidence
C1[Item]{ok:1,cf:0.95}:Toothpaste display clearly visible
C2[Item]{ok:1,cf:0.90}:Products neatly organized
C3[Item]{ok:1,cf:0.88}:Product names facing forward
C4[Item]{ok:1,cf:0.85}:Multiple SKUs present

YOUR RESPONSE (TOON ONLY, NO OTHER TEXT):`;
  }

  /**
   * Parse Cortex LISP response with per-item breakdown
   */
  private parseCortexResponse(cortexText: string): {
    score: number;
    pass: boolean;
    msg: string;
    items: Array<{
      itemNumber: number;
      itemName: string;
      status: boolean;
      message: string;
    }>;
  } {
    try {
      // Expected: (result (score 87.5) (pass t) (msg "Overall") (items (i1 (name "Item 1: ...") (pass t) (msg "...")) ...))
      const scoreMatch = cortexText.match(/\(score\s+([\d.]+)\)/);
      const passMatch = cortexText.match(/\(pass\s+(t|f|true|false)\)/);
      const msgMatch = cortexText.match(/\(msg\s+"([^"]+)"\)/);

      const score = parseFloat(scoreMatch?.[1] || '0');
      const pass = ['t', 'true'].includes(passMatch?.[1]?.toLowerCase() || 'f');
      const msg = msgMatch?.[1] || 'No feedback';

      // Parse items section
      const items: Array<{
        itemNumber: number;
        itemName: string;
        status: boolean;
        message: string;
      }> = [];

      // Extract items block: (items (...) (...) ...)
      const itemsBlockMatch = cortexText.match(/\(items\s+(.*)\)\s*\)/s);
      if (itemsBlockMatch) {
        const itemsContent = itemsBlockMatch[1];

        // Match individual items: (i1 (name "...") (pass t/f) (msg "..."))
        const itemRegex =
          /\(i(\d+)\s+\(name\s+"([^"]+)"\)\s+\(pass\s+(t|f|true|false)\)\s+\(msg\s+"([^"]+)"\)\)/g;
        let itemMatch;

        while ((itemMatch = itemRegex.exec(itemsContent)) !== null) {
          const itemNumber = parseInt(itemMatch[1]);
          const itemName = itemMatch[2];
          const itemPass = ['t', 'true'].includes(
            itemMatch[3]?.toLowerCase() || 'f',
          );
          const itemMsg = itemMatch[4];

          items.push({
            itemNumber,
            itemName,
            status: itemPass,
            message: itemMsg,
          });
        }
      }

      // If no items were parsed but we have a response, create a single default item
      if (items.length === 0) {
        items.push({
          itemNumber: 1,
          itemName: 'Overall Compliance',
          status: pass,
          message: msg,
        });
      }

      // Recalculate overall pass/fail based on actual items
      const actualPass =
        items.length > 0 ? items.every((item) => item.status) : pass;

      // Recalculate score based on items pass rate
      const passedItems = items.filter((item) => item.status).length;
      const actualScore =
        items.length > 0 ? (passedItems / items.length) * 100 : score;

      return {
        score: actualScore,
        pass: actualPass,
        msg:
          items.length > 0
            ? `${passedItems}/${items.length} items passed`
            : msg,
        items,
      };
    } catch (error) {
      this.logger.warn('Failed to parse Cortex response', {
        component: 'VisualComplianceOptimizedService',
        error: error instanceof Error ? error.message : String(error),
        response: cortexText.substring(0, 200),
      });
      return {
        score: 0,
        pass: false,
        msg: 'Parse error',
        items: [
          {
            itemNumber: 1,
            itemName: 'Parse Error',
            status: false,
            message: 'Failed to parse response',
          },
        ],
      };
    }
  }

  /**
   * Parse TOON response format
   */
  private parseToonResponse(toonText: string): any {
    const lines = toonText.trim().split('\n');

    // Check for ERROR response
    const errorLine = lines[0]?.match(/ERROR\[Analysis\]\{([^}]+)\}:(.+)/);
    if (errorLine) {
      const errorMessage = errorLine[2]?.trim() || 'Image analysis error';
      return {
        compliance_score: 0,
        pass_fail: false,
        overall_confidence: 0.99,
        feedback_message: errorMessage,
        criteria: [],
      };
    }

    // Line 1: Compliance[Result]{score:XX,pass:true/false,conf:0.XX}:summary
    const complianceLine = lines[0]?.match(
      /Compliance\[Result\]\{([^}]+)\}:(.+)/,
    );
    if (!complianceLine) {
      throw new Error('Invalid TOON format: Missing Compliance line');
    }

    const params = complianceLine[1];
    const scoreMatch = params.match(/score:(\d+)/);
    const passMatch = params.match(/pass:(true|false)/);
    const confMatch = params.match(/conf:([\d.]+)/);

    const result: {
      compliance_score: number;
      pass_fail: boolean;
      overall_confidence: number;
      feedback_message: string;
      criteria: Array<{
        criterion_number: number;
        compliant: boolean;
        confidence: number;
        message: string;
        reason: string;
      }>;
    } = {
      compliance_score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
      pass_fail: passMatch ? passMatch[1] === 'true' : false,
      overall_confidence: confMatch ? parseFloat(confMatch[1]) : 0.5,
      feedback_message:
        complianceLine[2]?.trim() || 'Compliance check completed',
      criteria: [],
    };

    // Lines 2+: C1[Item]{ok:1,cf:0.95}:reason
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const itemMatch = line.match(/C(\d+)\[Item\]\{([^}]+)\}:(.+)/);
      if (itemMatch) {
        const itemParams = itemMatch[2];
        const okMatch = itemParams.match(/ok:(\d+)/);
        const cfMatch = itemParams.match(/cf:([\d.]+)/);

        result.criteria.push({
          criterion_number: parseInt(itemMatch[1]),
          compliant: okMatch ? parseInt(okMatch[1]) === 1 : false,
          confidence: cfMatch ? parseFloat(cfMatch[1]) : 0.5,
          message: itemMatch[3]?.trim() || 'No details',
          reason: itemMatch[3]?.trim() || 'No details',
        });
      }
    }

    return result;
  }

  /**
   * Check cache for similar compliance requests
   */
  private async checkComplianceCache(
    request: VisualComplianceRequest,
  ): Promise<{ data: ComplianceResponse; strategy: string } | null> {
    try {
      const refHash = this.hashImage(request.referenceImage);
      const evidHash = this.hashImage(request.evidenceImage);
      const criteriaHash = this.hashCriteria(request.complianceCriteria);

      const cacheKey = `compliance:${request.industry}:${refHash}:${evidHash}:${criteriaHash}`;

      this.logger.debug('Checking compliance cache', {
        cacheKey,
        industry: request.industry,
        refHash: refHash.substring(0, 8),
        evidHash: evidHash.substring(0, 8),
        criteriaHash,
      });

      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        this.logger.info('✅ Visual compliance cache HIT', { cacheKey });
        return {
          data: cached as ComplianceResponse,
          strategy: 'exact_match',
        };
      } else {
        this.logger.info('❌ Visual compliance cache MISS', { cacheKey });
      }

      return null;
    } catch (error) {
      this.logger.warn('Cache check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Cache compliance result
   */
  private async cacheComplianceResult(
    request: VisualComplianceRequest,
    result: ComplianceResponse,
  ): Promise<void> {
    try {
      const refHash = this.hashImage(request.referenceImage);
      const evidHash = this.hashImage(request.evidenceImage);
      const criteriaHash = this.hashCriteria(request.complianceCriteria);

      const cacheKey = `compliance:${request.industry}:${refHash}:${evidHash}:${criteriaHash}`;
      const cacheTTL = 86400; // 24 hours

      await this.cacheService.set(cacheKey, result, cacheTTL);
      this.logger.info('💾 Visual compliance result cached', {
        cacheKey,
        ttl: cacheTTL,
        score: result.compliance_score,
        passFail: result.pass_fail,
      });
    } catch (error) {
      this.logger.warn('Failed to cache result', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Hash image for cache key
   */
  private hashImage(image: string | Buffer): string {
    const buffer =
      typeof image === 'string'
        ? Buffer.from(
            image.includes(',') ? image.split(',')[1] : image,
            'base64',
          )
        : image;
    return require('crypto')
      .createHash('md5')
      .update(buffer)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Hash compliance criteria for cache key
   */
  private hashCriteria(criteria: string[]): string {
    const criteriaString = criteria.join('|');
    return require('crypto')
      .createHash('md5')
      .update(criteriaString)
      .digest('hex')
      .substring(0, 12);
  }
}
