/**
 * Cortex Decoder
 * Uses AWS Bedrock LLMs to convert Cortex expressions back to natural language
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { 
  CortexResponse, 
  DecodeOptions,
  ResponseMetrics 
} from '../types';
import { PrimitiveIds } from './primitives';
import { loggingService } from '../../services/logging.service';
import { RetryWithBackoff } from '../../utils/retryWithBackoff';
import { encodeToTOON } from '../../utils/toon.utils';
import { BedrockModelFormatter } from '../utils/bedrockModelFormatter';

export class CortexDecoder {
  private bedrockClient: BedrockRuntimeClient;
  private decoderModelId: string;
  private systemPrompt: string;
  
  constructor() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    
    // Initialize with Amazon Nova Pro - powerful and cost-effective
    // Nova Pro: $0.80/1M tokens - great balance of speed and capability
    this.decoderModelId = process.env.CORTEX_DECODER_MODEL || 'amazon.nova-pro-v1:0';
    
    this.systemPrompt = this.buildSystemPrompt();
  }
  
  
  /**
   * Decode TRUE Cortex LISP format to natural language using Bedrock LLM
   */
  public async decode(
    response: CortexResponse, 
    options: DecodeOptions = {}
  ): Promise<string> {
    try {
      // Check if response contains TRUE Cortex LISP format
      const trueCortexLisp = response.metadata?.trueCortexFormat || 
                           response.roles?.trueCortexFormat ||
                           this.extractLispFromResponse(response);
      
      if (trueCortexLisp) {
        // Decode TRUE Cortex LISP format
        const decodedText = await this.decodeTrueCortexLisp(trueCortexLisp, options);
        return this.applyFormatting(decodedText, options);
      }
      
      // If simple response, try direct decoding
      if (this.isSimpleResponse(response)) {
        const directDecoded = this.directDecode(response, options);
        if (directDecoded) {
          return directDecoded;
        }
      }
      
      // Fallback to standard Bedrock decoding
      const decodedText = await this.decodeWithBedrock(response, options);
      
      // Apply formatting if requested
      return this.applyFormatting(decodedText, options);
    } catch (error) {
      loggingService.error('Cortex decoding failed', { error, response });
      throw error;
    }
  }
  
  /**
   * Use Bedrock LLM to decode the Cortex expression
   */
  private async decodeWithBedrock(
    response: CortexResponse,
    options: DecodeOptions
  ): Promise<string> {
    const prompt = await this.buildDecodingPrompt(response, options);
    
    // Use model override if provided
    const modelId = options.modelOverride || this.decoderModelId;
    
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
      maxTokens: options.maxLength || 2000,
      temperature: 0.3, // Slightly higher for natural language generation
      topP: 0.95
    });
    
    const command = new InvokeModelCommand({
      modelId: modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: requestBody // Already a JSON string from BedrockModelFormatter
    });
    
    const bedrockResponse = await RetryWithBackoff.execute(
      async () => this.bedrockClient.send(command),
      {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000
      }
    );
    
    if (!bedrockResponse.success || !bedrockResponse.result) {
      throw new Error('Failed to decode with Bedrock');
    }
    
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.result.body));
    
    // Use the formatter to parse the response
    const decodedText = BedrockModelFormatter.parseResponseBody(
      modelId,
      responseBody
    );
    
    // Log metrics if available
    if (response.metrics) {
      this.logDecodingMetrics(response.metrics, decodedText);
    }
    
    return decodedText;
  }
  
  /**
   * Build the system prompt for the decoder
   */
  private buildSystemPrompt(): string {
    return `You are a Cortex Decoder, specialized in converting structured Cortex expressions back into fluent, natural language.

CORTEX LANGUAGE SPECIFICATION:
- Cortex uses semantic frames (query, answer, event, state, etc.)
- Roles define semantic relationships (action, agent, target, etc.)
- Primitives are standardized concepts that must be translated to natural language

DECODING RULES:
1. Generate fluent, grammatically correct natural language
2. Preserve ALL semantic information from the Cortex expression
3. Use appropriate style based on the context (formal, casual, technical)
4. Maintain coherence when decoding multi-part responses
5. Translate primitive IDs back to human-readable terms
6. Handle nested structures by creating clear, logical sentences
7. Use appropriate conjunctions and transitions for readability

PRIMITIVE TRANSLATIONS:
- action_get -> "retrieve", "find", "get"
- action_create -> "create", "generate", "make"
- action_analyze -> "analyze", "examine", "evaluate"
- concept_document -> "document", "file"
- concept_report -> "report"
- prop_sentiment -> "sentiment", "feeling", "emotion"
(Use context-appropriate synonyms for variety)

Your output must be natural, fluent text that accurately represents the Cortex expression.`;
  }
  
  /**
   * Build the decoding prompt
   */
  private async buildDecodingPrompt(
    response: CortexResponse,
    options: DecodeOptions
  ): Promise<string> {
    // Expand any shortened primitives first
    const expandedResponse = this.expandPrimitives(response);
    
    // Simplified prompt for Nova compatibility
    const modelId = options.modelOverride || this.decoderModelId;
    const isNova = modelId.includes('amazon.nova');
    
    // Convert Cortex structure to TOON format for LLM
    const toonStructure = await encodeToTOON(expandedResponse);
    
    if (isNova) {
      // Ultra-simple prompt for Nova with TOON
      return `Convert to natural language (input in TOON format):
${toonStructure}`;
    }
    
    let prompt = `Convert the following Cortex expression into natural language (input in TOON format):

CORTEX EXPRESSION:
${toonStructure}

REQUIREMENTS:`;
    
    // Add style requirements
    if (options.style) {
      const styleGuides = {
        formal: 'Use formal, professional language',
        casual: 'Use casual, conversational language',
        technical: 'Use precise technical terminology',
        simple: 'Use simple, easy-to-understand language'
      };
      prompt += `\n- ${styleGuides[options.style]}`;
    }
    
    // Add format requirements
    if (options.format) {
      const formatGuides = {
        plain: 'Output plain text without formatting',
        markdown: 'Use Markdown formatting for structure',
        html: 'Use HTML tags for formatting',
        json: 'Output as a JSON object with structured fields'
      };
      prompt += `\n- ${formatGuides[options.format]}`;
    }
    
    // Add language requirements
    if (options.targetLanguage) {
      prompt += `\n- Translate the output to ${options.targetLanguage}`;
    }
    
    // Add length constraints
    if (options.maxLength) {
      prompt += `\n- Keep the response under ${options.maxLength} characters`;
    }
    
    // Handle different response statuses
    if (response.status === 'error') {
      prompt += '\n- Clearly explain the error in a helpful way';
    } else if (response.status === 'partial') {
      prompt += '\n- Indicate that this is a partial response and more information may be coming';
    }
    
    prompt += '\n\nGenerate the natural language output:';
    
    return prompt;
  }
  
  /**
   * Check if response can be directly decoded without LLM
   */
  private isSimpleResponse(response: CortexResponse): boolean {
    // Check if it's a simple answer with just content
    if (response.frame === 'answer' && 
        response.roles.content && 
        typeof response.roles.content === 'string') {
      return true;
    }
    
    // Check if it's a simple list
    if (response.frame === 'list' && 
        response.roles.items && 
        Array.isArray(response.roles.items)) {
      return true;
    }
    
    // Check if it's an error
    if (response.frame === 'error') {
      return true;
    }
    
    return false;
  }
  
  /**
   * Direct decode simple responses without LLM
   */
  private directDecode(response: CortexResponse, options: DecodeOptions): string | null {
    try {
      if (response.frame === 'answer' && response.roles.content) {
        return String(response.roles.content);
      }
      
      if (response.frame === 'list' && response.roles.items) {
        const items = response.roles.items as any[];
        if (options.format === 'markdown') {
          return items.map(item => `- ${item}`).join('\n');
        }
        return items.join(', ');
      }
      
      if (response.frame === 'error') {
        const code = response.roles.code || 'ERROR';
        const message = response.roles.message || 'An error occurred';
        return `Error ${code}: ${message}`;
      }
      
      return null;
    } catch {
      return null;
    }
  }
  
  /**
   * Expand shortened primitives back to full form
   */
  private expandPrimitives(obj: any): any {
    if (typeof obj === 'string') {
      // Expand shortened primitives
      if (obj.startsWith('a_')) {
        return obj.replace('a_', 'action_');
      }
      if (obj.startsWith('c_')) {
        return obj.replace('c_', 'concept_');
      }
      if (obj.startsWith('p_')) {
        return obj.replace('p_', 'prop_');
      }
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.expandPrimitives(item));
    }
    
    if (typeof obj === 'object' && obj !== null) {
      const expanded: any = {};
      for (const [key, value] of Object.entries(obj)) {
        // Expand single-letter role names
        const expandedKey = this.expandRoleName(key);
        expanded[expandedKey] = this.expandPrimitives(value);
      }
      return expanded;
    }
    
    return obj;
  }
  
  /**
   * Expand single-letter role names
   */
  private expandRoleName(key: string): string {
    const roleExpansion: Record<string, string> = {
      'a': 'action',
      't': 'target',
      'g': 'agent',
      'o': 'object',
      'p': 'properties'
    };
    
    return roleExpansion[key] || key;
  }
  
  /**
   * Apply formatting to the decoded text
   */
  private applyFormatting(text: string, options: DecodeOptions): string {
    if (!options.format || options.format === 'plain') {
      return text;
    }
    
    switch (options.format) {
      case 'markdown':
        return this.formatAsMarkdown(text);
      case 'html':
        return this.formatAsHtml(text);
      case 'json':
        return JSON.stringify({ text, format: 'decoded' }, null, 2);
      default:
        return text;
    }
  }
  
  /**
   * Format text as Markdown
   */
  private formatAsMarkdown(text: string): string {
    // Add basic Markdown formatting
    let formatted = text;
    
    // Make headers for sentences ending with colon
    formatted = formatted.replace(/^(.+:)$/gm, '### $1');
    
    // Add line breaks for readability
    formatted = formatted.replace(/\. /g, '.\n\n');
    
    return formatted;
  }
  
  /**
   * Format text as HTML
   */
  private formatAsHtml(text: string): string {
    // Add basic HTML formatting
    let formatted = `<div class="cortex-decoded">`;
    
    // Split into paragraphs
    const paragraphs = text.split(/\n\n/);
    for (const paragraph of paragraphs) {
      formatted += `<p>${paragraph}</p>`;
    }
    
    formatted += `</div>`;
    
    return formatted;
  }
  
  /**
   * Log decoding metrics
   */
  private logDecodingMetrics(metrics: ResponseMetrics, decodedText: string): void {
    loggingService.info('Cortex decoding completed', {
      originalTokens: metrics.originalTokens,
      optimizedTokens: metrics.optimizedTokens,
      tokenReduction: metrics.tokenReduction,
      decodedLength: decodedText.length,
      costSavings: metrics.costSavings,
      modelUsed: this.decoderModelId
    });
  }
  
  /**
   * Batch decode multiple Cortex responses
   */
  public async batchDecode(
    responses: CortexResponse[], 
    options: DecodeOptions = {}
  ): Promise<string[]> {
    // Process in parallel for efficiency
    const promises = responses.map(response => this.decode(response, options));
    return Promise.all(promises);
  }
  
  /**
   * Stream decode for real-time applications
   */
  public async *streamDecode(
    response: CortexResponse,
    options: DecodeOptions = {}
  ): AsyncGenerator<string> {
    // For now, we'll decode the full response and yield it in chunks
    // In a future implementation, this could use Bedrock's streaming API
    const fullText = await this.decode(response, options);
    
    // Yield in sentence chunks
    const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
    for (const sentence of sentences) {
      yield sentence;
      // Small delay to simulate streaming
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  /**
   * Extract LISP format from response
   */
  private extractLispFromResponse(response: CortexResponse): string | null {
    // Try to find LISP format in various places
    if (response.metadata?.trueCortexFormat) {
      return response.metadata.trueCortexFormat as string;
    }
    
    if (response.roles?.content && typeof response.roles.content === 'string') {
      // Check if content looks like LISP
      if (response.roles.content.trim().startsWith('(') && response.roles.content.includes(':')) {
        return response.roles.content;
      }
    }
    
    return null;
  }
  
  /**
   * Decode TRUE Cortex LISP format using Bedrock
   */
  private async decodeTrueCortexLisp(
    cortexLisp: string,
    options: DecodeOptions
  ): Promise<string> {
    const prompt = this.buildTrueCortexDecodingPrompt(cortexLisp, options);
    
    // Use model override if provided
    const modelId = options.modelOverride || this.decoderModelId;
    
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
      systemPrompt: isNova ? undefined : this.buildTrueCortexSystemPrompt(),
      maxTokens: options.maxLength || 2000,
      temperature: 0.3,
      topP: 0.95
    });
    
    const command = new InvokeModelCommand({
      modelId: modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: requestBody
    });
    
    const bedrockResponse = await RetryWithBackoff.execute(
      async () => this.bedrockClient.send(command),
      {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000
      }
    );
    
    if (!bedrockResponse.success || !bedrockResponse.result) {
      throw new Error('Failed to decode TRUE Cortex with Bedrock');
    }
    
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.result.body));
    
    // Use the formatter to parse the response
    const decodedText = BedrockModelFormatter.parseResponseBody(
      modelId,
      responseBody
    );
    
    loggingService.info('True Cortex decoding completed', {
      cortexLength: cortexLisp.length,
      decodedLength: decodedText.length,
      modelUsed: modelId,
      primitiveCount: this.countPrimitivesInLisp(cortexLisp)
    });
    
    return decodedText;
  }
  
  /**
   * Build TRUE Cortex decoding prompt
   */
  private buildTrueCortexDecodingPrompt(
    cortexLisp: string,
    options: DecodeOptions
  ): string {
    // Simplified prompt for Nova compatibility
    const modelId = options.modelOverride || this.decoderModelId;
    const isNova = modelId.includes('amazon.nova');
    
    if (isNova) {
      // Ultra-simple prompt for Nova
      return `Convert LISP to text: ${cortexLisp}`;
    }
    
    let prompt = `Convert this TRUE Cortex LISP expression into natural, fluent language:

CORTEX LISP EXPRESSION:
${cortexLisp}

DECODING REQUIREMENTS:
- Convert primitive IDs to natural language (${PrimitiveIds.action_jump} = jump, ${PrimitiveIds.concept_fox} = fox)
- Resolve references like $task_1.target
- Create fluent, grammatically correct sentences
- Combine multiple tasks into coherent paragraphs
- Preserve ALL semantic meaning`;
    
    if (options.style) {
      const styleGuides = {
        formal: 'Use formal, professional language',
        casual: 'Use casual, conversational language', 
        technical: 'Use precise technical terminology',
        simple: 'Use simple, easy-to-understand language'
      };
      prompt += `\n- ${styleGuides[options.style]}`;
    }
    
    if (options.format) {
      const formatGuides = {
        plain: 'Output plain text without formatting',
        markdown: 'Use Markdown formatting for structure', 
        html: 'Use HTML tags for formatting',
        json: 'Output as a JSON object with structured fields'
      };
      prompt += `\n- ${formatGuides[options.format]}`;
    }
    
    prompt += '\n\nGenerate the natural language output:';
    
    return prompt;
  }
  
  /**
   * Count primitives in LISP format
   */
  private countPrimitivesInLisp(lispFormat: string): number {
    const primitiveMatches = lispFormat.match(/\d+\s*\/\//g);
    return primitiveMatches ? primitiveMatches.length : 0;
  }
  
  /**
   * Build the system prompt for TRUE Cortex decoding
   */
  private buildTrueCortexSystemPrompt(): string {
    return `You are a TRUE Cortex Decoder specialized in converting Cortex LISP expressions into natural language.

CORTEX LISP SPECIFICATION:
- Format: (frame: role:value role:value)
- Primitive IDs: ${PrimitiveIds.action_jump}=jump, ${PrimitiveIds.concept_fox}=fox, ${PrimitiveIds.prop_quick}=quick
- References: $task_1.target points to target from task_1
- Multi-task: (task_1: ...) (task_2: ...) become separate sentences

DECODING RULES:
1. Convert primitive IDs to natural words
2. Resolve all $references
3. Generate fluent, grammatically correct text
4. Combine tasks with appropriate conjunctions
5. Preserve complete semantic meaning
6. Use natural language flow

EXAMPLE:
Input: (event:${PrimitiveIds.action_jump} agent:(entity:${PrimitiveIds.concept_fox} properties:[${PrimitiveIds.prop_quick}, ${PrimitiveIds.prop_brown}]))
Output: "The quick brown fox jumps"

Your output must be natural, fluent language that represents the Cortex LISP expression.`;
  }
}

/**
 * Singleton instance for easy access
 */
export const cortexDecoder = new CortexDecoder();
