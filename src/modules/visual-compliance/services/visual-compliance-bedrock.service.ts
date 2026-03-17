import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../../common/logger/logger.service';
import { BedrockService } from '../../bedrock/bedrock.service';
import { AiCostTrackingService } from './ai-cost-tracking.service';

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
export class VisualComplianceBedrockService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly costTrackingService: AiCostTrackingService,
    private readonly bedrockService: BedrockService,
  ) {}

  /**
   * Invoke Claude with image using Messages API
   */
  async invokeWithImage(
    prompt: string,
    imageBase64: string,
    userId: string,
    modelId: string = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  ): Promise<{
    response: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }> {
    this.logger.info('🚨 BEDROCK SERVICE invokeWithImage CALLED', {
      component: 'VisualComplianceBedrockService',
      imageLength: imageBase64?.length || 0,
      userId,
      modelId,
    });

    try {
      const result = await BedrockService.invokeWithImage(
        prompt,
        imageBase64,
        userId,
        modelId,
      );

      this.logger.info('Claude with image invocation completed', {
        component: 'VisualComplianceBedrockService',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: result.cost,
      });

      return result;
    } catch (error) {
      this.logger.error('Error invoking Claude with image', {
        component: 'VisualComplianceBedrockService',
        error: error instanceof Error ? error.message : String(error),
        modelId,
      });
      throw error;
    }
  }

  /**
   * Invoke Amazon Nova Pro with images
   */
  async invokeNovaProWithImages(
    referenceImage: string,
    evidenceImage: string,
    prompt: string,
  ): Promise<ComplianceResponse> {
    const startTime = Date.now();

    const modelId = 'amazon.nova-pro-v1:0';

    // Convert base64 to proper format (remove data URL prefix if present)
    const refImageData = referenceImage.includes('base64,')
      ? referenceImage.split('base64,')[1]
      : referenceImage;
    const evidImageData = evidenceImage.includes('base64,')
      ? evidenceImage.split('base64,')[1]
      : evidenceImage;

    // Determine image format
    const refFormat = referenceImage.includes('image/png') ? 'png' : 'jpeg';
    const evidFormat = evidenceImage.includes('image/png') ? 'png' : 'jpeg';

    const requestBody = {
      messages: [
        {
          role: 'user',
          content: [
            {
              image: {
                format: refFormat,
                source: {
                  bytes: refImageData,
                },
              },
            },
            {
              image: {
                format: evidFormat,
                source: {
                  bytes: evidImageData,
                },
              },
            },
            {
              text: `Reference Image (first) vs Evidence Image (second):\n\n${prompt}`,
            },
          ],
        },
      ],
      inferenceConfig: {
        max_new_tokens: 500,
        temperature: 0.1,
        topP: 0.9,
      },
    };

    const result = await BedrockService.invokeModelDirectly(
      modelId,
      requestBody,
    );
    const responseText = result.response;
    const inputTokens = result.inputTokens;
    const outputTokens = result.outputTokens;

    this.logger.info('Nova Pro response received', {
      responseLength: responseText.length,
      inputTokens,
      outputTokens,
    });

    // Parse Cortex LISP response
    const complianceData = this.parseCortexResponse(responseText);

    // Calculate cost (Nova Pro: $0.80 input, $3.20 output per 1M tokens)
    const cost =
      (inputTokens / 1_000_000) * 0.8 + (outputTokens / 1_000_000) * 3.2;

    // Calculate processing cost (internal LLM processing cost)
    const internalProcessingCost = cost;
    const processingCost = internalProcessingCost;

    this.logger.info('Processing cost calculated', {
      internalProcessingCost,
      processingCost,
    });

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
        technique: 'nova_pro_visual_cortex',
        internalProcessingCost,
        processingCost,
      },
    };
  }

  /**
   * Parse Cortex LISP response format from AI model
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
        component: 'VisualComplianceBedrockService',
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
}
