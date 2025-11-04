/**
 * Cortex Encoder
 * Uses AWS Bedrock LLMs to convert natural language into optimized Cortex expressions
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { 
  CortexQuery, 
  CortexExpression, 
  EncodeOptions, 
  CompressedQuery,
  CompressionMetadata,
} from '../types';
import { CorePrimitives, PrimitiveIds } from './primitives';
import { CortexParser } from './parser';
import { trueCortexParser } from './semanticParser';
import { loggingService } from '../../services/logging.service';
import { RetryWithBackoff } from '../../utils/retryWithBackoff';
import { BedrockModelFormatter } from '../utils/bedrockModelFormatter';

export class CortexEncoder {
  private bedrockClient: BedrockRuntimeClient;
  private parser: CortexParser;
  private encoderModelId: string;
  private systemPrompt: string;
  
  constructor() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    
    this.parser = new CortexParser();
    
    // Initialize with Amazon Nova Pro - powerful and cost-effective
    // Nova Pro: $0.80/1M tokens - great balance of speed and capability
    this.encoderModelId = process.env.CORTEX_ENCODER_MODEL || 'amazon.nova-pro-v1:0';
    
    this.systemPrompt = this.buildSystemPrompt();
    
  }
  
  /**
   * Encode natural language to TRUE Cortex LISP format using Bedrock LLM
   */
  public async encode(input: string, options: EncodeOptions = {}): Promise<CortexQuery> {
    try {
      // Generate TRUE Cortex LISP format first
      const trueCortexFormat = this.parser.parseClassicExample(input);
      
          // Convert to expression object for compatibility
    this.lispToExpression(trueCortexFormat);
      
      // Use Bedrock LLM to refine the TRUE Cortex format (not JSON)
      const refinedExpression = await this.refineWithBedrock(input, trueCortexFormat, options);
      
      // Apply compression if requested
      if (options.compressionLevel && options.compressionLevel !== 'none') {
        return await this.applyCompression(refinedExpression, options.compressionLevel);
      }
      
      return refinedExpression;
    } catch (error) {
      loggingService.error('Cortex encoding failed', { error, input });
      throw error;
    }
  }
  
  /**
   * Convert LISP to CortexExpression for compatibility
   */
  private lispToExpression(lispFormat: string): CortexExpression {
    return {
      frame: 'query' as any,
      roles: { trueCortexFormat: lispFormat },
      metadata: {
        trueCortexFormat: lispFormat,
        timestamp: Date.now(),
        source: 'true_cortex_encoder'
      }
    };
  }
  
  /**
   * Use Bedrock LLM to refine the TRUE Cortex LISP format
   */
  private async refineWithBedrock(
    originalInput: string, 
    trueCortexFormat: string,
    options: EncodeOptions
  ): Promise<CortexQuery> {
    const prompt = this.buildTrueCortexPrompt(originalInput, trueCortexFormat, options);
    
    // Use model override if provided
    const modelId = options.modelOverride || this.encoderModelId;
    
    // Use the formatter to create the correct request format
    // For Nova, avoid complex system prompts
    const isNova = modelId.includes('amazon.nova');
    const requestBody = BedrockModelFormatter.formatRequestBody({
      modelId: modelId,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      systemPrompt: isNova ? undefined : this.systemPrompt, // Skip system prompt for Nova
      maxTokens: 1000,
      temperature: 0.1, // Low temperature for consistent encoding
      topP: 0.9
    });
    
    const command = new InvokeModelCommand({
      modelId: modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: requestBody // Already a JSON string from BedrockModelFormatter
    });
    
    const response = await RetryWithBackoff.execute(
      async () => this.bedrockClient.send(command),
      {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000
      }
    );
    
    if (!response.success || !response.result) {
      throw new Error('Failed to encode with Bedrock');
    }
    
    const responseBody = JSON.parse(new TextDecoder().decode(response.result.body));
    
    // Use the formatter to parse the response
    const responseText = BedrockModelFormatter.parseResponseBody(
      modelId,
      responseBody
    );
    const refinedCortexLisp = this.extractTrueCortexFromResponse(responseText);
    
    // Convert to expression object for compatibility
    const cortexExpression = this.lispToExpression(refinedCortexLisp);
    
    // Log metrics
    loggingService.info('True Cortex encoding completed', {
      originalLength: originalInput.length,
      trueCortexLength: refinedCortexLisp.length,
      compressionRatio: originalInput.length / refinedCortexLisp.length,
      primitiveCount: this.countPrimitives(refinedCortexLisp),
      modelUsed: modelId
    });
    
    return this.enhanceWithOptimizationHints(cortexExpression, refinedCortexLisp);
  }
  
  /**
   * Build TRUE Cortex prompt for Bedrock refinement
   */
  private buildTrueCortexPrompt(
    originalInput: string,
    cortexFormat: string,
    options: EncodeOptions
  ): string {
    // Simplified prompt for Nova Pro compatibility
    const modelId = options.modelOverride || this.encoderModelId;
    const isNova = modelId.includes('amazon.nova');
    
    if (isNova) {
      // Ultra-simple prompt for Nova - avoid complex formatting
      return `Convert to Cortex: ${originalInput}`;
    }
    
    // Regular prompt for Claude models
    let prompt = `Refine this Cortex LISP expression to be more semantically explicit and optimized:

ORIGINAL INPUT: "${originalInput}"

CURRENT CORTEX FORMAT:
${cortexFormat}

REFINEMENT REQUIREMENTS:
- Use exact primitive IDs with comments (e.g., ${PrimitiveIds.action_jump}                    // ${PrimitiveIds.action_jump} = jump)
- Maintain LISP syntax exactly: (frame: role:value role:value)
- Remove ALL ambiguity from the original input
- Use references like $task_1.target to avoid redundancy
- Preserve complete semantic meaning while optimizing structure`;
    
    if (options.compressionLevel === 'aggressive') {
      prompt += '\n- Apply maximum compression while maintaining semantic integrity';
    }
    
    prompt += '\n\nOutput the refined Cortex LISP expression:';
    
    return prompt;
  }
  
  /**
   * Build the system prompt for TRUE Cortex processing
   */
  private buildSystemPrompt(): string {
    return `You are a Cortex Encoder specialized in the TRUE Cortex meta-language LISP format.

CORTEX SPECIFICATION:
- Cortex uses LISP syntax: (frame: role:value role:value)
- Primitives use IDs: action_${PrimitiveIds.action_jump} = jump, concept_${PrimitiveIds.concept_fox} = fox
- References use $task_1.target format
- Multi-task queries have separate (task_1: ...) (task_2: ...) blocks

PRIMITIVE ID MAPPINGS:
Actions: jump=${PrimitiveIds.action_jump}, get=${PrimitiveIds.action_get}, analyze=${PrimitiveIds.action_analyze}
Concepts: fox=${PrimitiveIds.concept_fox}, dog=${PrimitiveIds.concept_dog}, movie=${PrimitiveIds.concept_movie}
Properties: quick=${PrimitiveIds.prop_quick}, brown=${PrimitiveIds.prop_brown}, lazy=${PrimitiveIds.prop_lazy}
Modifiers: latest=${PrimitiveIds.mod_latest}, definite=${PrimitiveIds.mod_definite}

ENCODING RULES:
1. Convert to EXACT Cortex LISP format with primitive IDs
2. Use comments for clarity: // ${PrimitiveIds.action_jump} = jump
3. Separate multiple tasks: (task_1: ...) (task_2: ...)
4. Use references: $task_1.target
5. Remove ALL natural language ambiguity
6. Output pure LISP format, not JSON

CORE PRIMITIVES REFERENCE:
Actions: ${Object.keys(CorePrimitives.actions).slice(0, 20).join(', ')}...
Concepts: ${Object.keys(CorePrimitives.concepts).slice(0, 20).join(', ')}...
Properties: ${Object.keys(CorePrimitives.properties).slice(0, 20).join(', ')}...

Your output must be a valid JSON object representing the Cortex expression.`;
  }
  
  /**
   * Extract TRUE Cortex LISP format from LLM response
   */
  private extractTrueCortexFromResponse(response: string): string {
    try {
      // Look for LISP format in the response
      const lispMatch = response.match(/\([^)]+:[\s\S]*?\)/);
      if (lispMatch) {
        return lispMatch[0];
      }
      
      // If no LISP found, try to extract from code blocks
      const codeBlockMatch = response.match(/```(?:lisp)?\n?([\s\S]*?)\n?```/i);
      if (codeBlockMatch && codeBlockMatch[1]) {
        return codeBlockMatch[1].trim();
      }
      
      // Fallback: assume the entire response is Cortex
      return response.trim();
    } catch (error) {
      loggingService.error('Failed to extract True Cortex from LLM response', { response, error });
      
      // Ultimate fallback: use the parser to generate a basic format
      return trueCortexParser.parseToTrueCortex(response);
    }
  }
  
  /**
   * Count primitives in LISP format
   */
  private countPrimitives(cortexLisp: string): number {
    // Count primitive ID references (number followed by // comment)
    const primitiveMatches = cortexLisp.match(/\d+\s*\/\/\s*\d+\s*=\s*\w+/g);
    return primitiveMatches ? primitiveMatches.length : 0;
  }
  
  /**
   * Enhance with optimization hints including LISP format
   */
  private enhanceWithOptimizationHints(
    expression: CortexExpression, 
    trueCortexLisp: string
  ): CortexQuery {
    const query: CortexQuery = {
      ...expression,
      metadata: {
        ...expression.metadata,
        trueCortexFormat: trueCortexLisp, // Store the true LISP format
        primitiveCount: this.countPrimitives(trueCortexLisp),
        tokenOptimization: {
          originalFormat: 'natural_language',
          optimizedFormat: 'true_cortex_lisp',
          compressionAchieved: true
        }
      },
      optimizationHints: {
        targetTokenReduction: 0.7, // Higher with true Cortex
        prioritize: 'cost',
        enableCaching: true,
        enableCompression: true,
        maxLatency: 2000
      },
      routingPreferences: {
        preferredModels: ['amazon.nova-pro-v1:0'],
        allowFallback: true,
        maxCost: 0.01
      },
      executionConstraints: {
        timeout: 30000,
        maxRetries: 3,
        parallelExecution: true,
        toolUseAllowed: true
      }
    };
    
    return query;
  }
  
  
  /**
   * Apply compression to the Cortex query
   */
  private async applyCompression(
    query: CortexQuery, 
    level: 'basic' | 'aggressive' | 'neural'
  ): Promise<CortexQuery> {
    switch (level) {
      case 'basic':
        return this.basicCompression(query);
      case 'aggressive':
        return this.aggressiveCompression(query);
      case 'neural':
        return await this.neuralCompression(query);
      default:
        return query;
    }
  }
  
  /**
   * Basic compression - remove redundancy
   */
  private basicCompression(query: CortexQuery): CortexQuery {
    const compressed = { ...query };
    
    // Remove null/undefined values
    compressed.roles = Object.fromEntries(
      Object.entries(compressed.roles).filter(([_, v]) => v != null)
    );
    
    // Shorten primitive names
    compressed.roles = this.shortenPrimitives(compressed.roles);
    
    return compressed;
  }
  
  /**
   * Aggressive compression - restructure for minimal size
   */
  private aggressiveCompression(query: CortexQuery): CortexQuery {
    const compressed = this.basicCompression(query);
    
    // Use single-letter role names
    const roleMap: Record<string, string> = {
      'action': 'a',
      'target': 't',
      'agent': 'g',
      'object': 'o',
      'properties': 'p'
    };
    
    compressed.roles = Object.fromEntries(
      Object.entries(compressed.roles).map(([k, v]) => [roleMap[k] || k, v])
    );
    
    // Remove metadata if not essential
    if (compressed.metadata && !compressed.metadata.id) {
      delete compressed.metadata;
    }
    
    return compressed;
  }
  
  /**
   * Neural compression - use Bedrock embeddings for vector representation
   */
  private async neuralCompression(query: CortexQuery): Promise<CortexQuery> {
    try {
      // Use Amazon Titan Embeddings model for neural compression
      const embeddingModel = 'amazon.titan-embed-text-v2:0';
      const queryText = JSON.stringify(query);
      
      const requestBody = {
        inputText: queryText,
        dimensions: 512, // Compress to 512-dimensional vector
        normalize: true
      };
      
      const command = new InvokeModelCommand({
        modelId: embeddingModel,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody) // Need to stringify for embeddings API
      });
      
      const response = await RetryWithBackoff.execute(
        async () => this.bedrockClient.send(command),
        {
          maxRetries: 3,
          baseDelay: 1000,
          maxDelay: 10000
        }
      );
      
      if (!response.success || !response.result) {
        throw new Error('Failed to apply neural compression with Bedrock');
      }
      
      const responseBody = JSON.parse(new TextDecoder().decode(response.result.body));
      const embedding = responseBody.embedding;
      
      // Store the vector representation with metadata for reconstruction
      const compressedQuery: CortexQuery = {
        ...query,
        metadata: {
          ...query.metadata,
          neuralCompression: {
            enabled: true,
            vectorDimensions: embedding.length,
            originalHash: this.hashString(queryText),
            compressionTimestamp: Date.now()
          },
          compressedVector: embedding
        }
      };
      
      loggingService.info('Neural compression applied', {
        originalSize: queryText.length,
        vectorSize: embedding.length,
        compressionRatio: queryText.length / (embedding.length * 4) // 4 bytes per float
      });
      
      return compressedQuery;
    } catch (error) {
      loggingService.warn('Neural compression failed, falling back to aggressive compression', { error });
      return this.aggressiveCompression(query);
    }
  }
  
  /**
   * Generate hash for string
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }
  
  /**
   * Shorten primitive identifiers
   */
  private shortenPrimitives(roles: Record<string, any>): Record<string, any> {
    const shortened: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(roles)) {
      if (typeof value === 'string' && value.startsWith('action_')) {
        // Shorten action primitives
        shortened[key] = value.replace('action_', 'a_');
      } else if (typeof value === 'string' && value.startsWith('concept_')) {
        // Shorten concept primitives
        shortened[key] = value.replace('concept_', 'c_');
      } else if (typeof value === 'string' && value.startsWith('prop_')) {
        // Shorten property primitives
        shortened[key] = value.replace('prop_', 'p_');
      } else if (typeof value === 'object' && value !== null) {
        // Recursively shorten nested objects
        shortened[key] = this.shortenPrimitives(value);
      } else {
        shortened[key] = value;
      }
    }
    
    return shortened;
  }
  
  /**
   * Compress a Cortex query to binary format
   */
  public async compressToBinary(query: CortexQuery): Promise<CompressedQuery> {
    const jsonString = JSON.stringify(query);
    const encoder = new TextEncoder();
    const data = encoder.encode(jsonString);
    
    // In a real implementation, this would use actual compression algorithms
    const metadata: CompressionMetadata = {
      originalSize: jsonString.length,
      compressedSize: data.length,
      compressionRatio: jsonString.length / data.length,
      algorithm: 'utf8-encoding',
      timestamp: Date.now()
    };
    
    return {
      format: 'binary',
      data: data,
      metadata
    };
  }
  
  /**
   * Batch encode multiple inputs for efficiency
   */
  public async batchEncode(
    inputs: string[], 
    options: EncodeOptions = {}
  ): Promise<CortexQuery[]> {
    // Process in parallel for efficiency
    const promises = inputs.map(input => this.encode(input, options));
    return Promise.all(promises);
  }
}

/**
 * Singleton instance for easy access
 */
export const cortexEncoder = new CortexEncoder();

