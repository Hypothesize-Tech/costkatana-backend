/**
 * Bedrock Model Request Formatter
 * Handles different request formats for various model providers
 */

import { loggingService } from '../../services/logging.service';

export interface ModelRequest {
  modelId: string;
  prompt?: string;
  messages?: any[];
  maxTokens: number;
  temperature?: number;
  topP?: number;
  systemPrompt?: string;
}

export class BedrockModelFormatter {
  /**
   * Format request body based on model provider
   */
  public static formatRequestBody(request: ModelRequest): string {
    const { modelId } = request;
    
    if (modelId.includes('anthropic.claude')) {
      return this.formatClaudeRequest(request);
    } else if (modelId.includes('amazon.nova')) {
      return this.formatNovaRequest(request);
    } else if (modelId.includes('amazon.titan')) {
      return this.formatTitanRequest(request);
    } else if (modelId.includes('meta.llama')) {
      return this.formatLlamaRequest(request);
    } else if (modelId.includes('mistral')) {
      return this.formatMistralRequest(request);
    } else if (modelId.includes('cohere')) {
      return this.formatCohereRequest(request);
    } else if (modelId.includes('ai21')) {
      return this.formatAI21Request(request);
    } else {
      // Default to Claude format as fallback
      return this.formatClaudeRequest(request);
    }
  }
  
  /**
   * Parse response body based on model provider
   */
  public static parseResponseBody(modelId: string, responseBody: any): string {
    try {
      if (modelId.includes('anthropic.claude')) {
        return responseBody.content?.[0]?.text || '';
      } else if (modelId.includes('amazon.nova')) {
        return responseBody.output?.message?.content?.[0]?.text || '';
      } else if (modelId.includes('amazon.titan')) {
        return responseBody.results?.[0]?.outputText || responseBody.outputText || '';
      } else if (modelId.includes('meta.llama')) {
        return responseBody.generation || '';
      } else if (modelId.includes('mistral')) {
        return responseBody.outputs?.[0]?.text || '';
      } else if (modelId.includes('cohere')) {
        return responseBody.generations?.[0]?.text || '';
      } else if (modelId.includes('ai21')) {
        return responseBody.completions?.[0]?.data?.text || '';
      } else {
        // Try common response formats
        return responseBody.content?.[0]?.text || 
               responseBody.output?.message?.content?.[0]?.text ||
               responseBody.results?.[0]?.outputText ||
               responseBody.generation ||
               responseBody.text ||
               JSON.stringify(responseBody);
      }
    } catch (error) {
      loggingService.warn('Failed to parse response body', { modelId, error });
      return JSON.stringify(responseBody);
    }
  }
  
  /**
   * Format request for Claude models
   */
  private static formatClaudeRequest(request: ModelRequest): string {
    const body: any = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: request.maxTokens,
      temperature: request.temperature || 0.5
    };
    
    // Only add system prompt if it's provided and not undefined
    if (request.systemPrompt && request.systemPrompt.trim()) {
      body.system = request.systemPrompt;
    }
    
    if (request.messages) {
      body.messages = request.messages;
    } else if (request.prompt) {
      body.messages = [{ role: 'user', content: request.prompt }];
    }
    
    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }
    
    return JSON.stringify(body);
  }
  
  /**
   * Format request for Amazon Nova models
   */
  private static formatNovaRequest(request: ModelRequest): string {
    const body: any = {
      inferenceConfig: {
        maxTokens: request.maxTokens || 2048,
        temperature: request.temperature || 0.7
      }
    };
    
    // Add topP if provided  
    if (request.topP !== undefined) {
      body.inferenceConfig.topP = request.topP;
    }
    
    // Combine system prompt with user message for Nova
    let userMessage = '';
    if (request.systemPrompt) {
      userMessage = request.systemPrompt + '\n\n';
    }
    
    if (request.messages && request.messages.length > 0) {
      // Take the last user message
      const lastMessage = request.messages[request.messages.length - 1];
      userMessage += Array.isArray(lastMessage.content) 
        ? lastMessage.content.map((c: any) => c.text || c).join(' ')
        : String(lastMessage.content || '');
    } else if (request.prompt) {
      userMessage += String(request.prompt || '');
    }
    
    // Nova format: simple messages array without system
    body.messages = [{ 
      role: 'user', 
      content: [{ text: userMessage }] 
    }];
    
    return JSON.stringify(body);
  }
  
  /**
   * Format request for Amazon Titan models
   */
  private static formatTitanRequest(request: ModelRequest): string {
    const body: any = {
      inputText: request.prompt || '',
      textGenerationConfig: {
        maxTokenCount: request.maxTokens,
        temperature: request.temperature || 0.5
      }
    };
    
    if (request.messages && request.messages.length > 0) {
      // Titan doesn't support message format, convert to text
      body.inputText = request.messages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');
    }
    
    if (request.topP !== undefined) {
      body.textGenerationConfig.topP = request.topP;
    }
    
    return JSON.stringify(body);
  }
  
  /**
   * Format request for Meta Llama models
   */
  private static formatLlamaRequest(request: ModelRequest): string {
    const body: any = {
      max_gen_len: request.maxTokens,
      temperature: request.temperature || 0.5
    };
    
    if (request.messages && request.messages.length > 0) {
      // Convert messages to Llama prompt format
      const promptParts = [];
      if (request.systemPrompt) {
        promptParts.push(`System: ${request.systemPrompt}`);
      }
      request.messages.forEach(msg => {
        promptParts.push(`${msg.role}: ${msg.content}`);
      });
      body.prompt = promptParts.join('\n') + '\nassistant:';
    } else if (request.prompt) {
      body.prompt = request.prompt;
    }
    
    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }
    
    return JSON.stringify(body);
  }
  
  /**
   * Format request for Mistral models
   */
  private static formatMistralRequest(request: ModelRequest): string {
    const body: any = {
      prompt: request.prompt || '',
      max_tokens: request.maxTokens,
      temperature: request.temperature || 0.5
    };
    
    if (request.messages && request.messages.length > 0) {
      // Convert messages to prompt
      body.prompt = request.messages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');
    }
    
    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }
    
    return JSON.stringify(body);
  }
  
  /**
   * Format request for Cohere models
   */
  private static formatCohereRequest(request: ModelRequest): string {
    const body: any = {
      prompt: request.prompt || '',
      max_tokens: request.maxTokens,
      temperature: request.temperature || 0.5
    };
    
    if (request.messages && request.messages.length > 0) {
      body.prompt = request.messages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');
    }
    
    if (request.topP !== undefined) {
      body.p = request.topP;
    }
    
    return JSON.stringify(body);
  }
  
  /**
   * Format request for AI21 models
   */
  private static formatAI21Request(request: ModelRequest): string {
    const body: any = {
      prompt: request.prompt || '',
      maxTokens: request.maxTokens,
      temperature: request.temperature || 0.5
    };
    
    if (request.messages && request.messages.length > 0) {
      body.prompt = request.messages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');
    }
    
    if (request.topP !== undefined) {
      body.topP = request.topP;
    }
    
    return JSON.stringify(body);
  }
  
  /**
   * Check if a model supports streaming
   */
  public static supportsStreaming(modelId: string): boolean {
    // Most models support streaming except some older ones
    if (modelId.includes('titan-embed') || 
        modelId.includes('cohere.embed') ||
        modelId.includes('stability.')) {
      return false;
    }
    return true;
  }
  
  /**
   * Get the maximum context window for a model
   */
  public static getMaxContextWindow(modelId: string): number {
    const contextWindows: Record<string, number> = {
      // Claude models
      'anthropic.claude-3': 200000,
      'anthropic.claude-2': 100000,
      'anthropic.claude-instant': 100000,
      // Amazon Nova
      'amazon.nova-pro': 300000,
      'amazon.nova-lite': 300000,
      'amazon.nova-micro': 128000,
      // Amazon Titan
      'amazon.titan-text-premier': 32000,
      'amazon.titan-text-express': 8192,
      'amazon.titan-text-lite': 4096,
      // Meta Llama
      'meta.llama3': 128000,
      'meta.llama3-1': 128000,
      'meta.llama3-2': 128000,
      // Mistral
      'mistral.mistral-large': 128000,
      'mistral.mixtral': 32000,
      'mistral.mistral-7b': 32000,
      // Default
      'default': 4096
    };
    
    // Find the best match
    for (const [pattern, window] of Object.entries(contextWindows)) {
      if (modelId.includes(pattern)) {
        return window;
      }
    }
    
    return contextWindows.default;
  }
}

export default BedrockModelFormatter;
