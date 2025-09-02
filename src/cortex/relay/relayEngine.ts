/**
 * Cortex Relay Engine
 * Orchestrates the complete Cortex processing pipeline using AWS Bedrock
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { 
  CortexQuery, 
  CortexResponse, 
  ModelSelection,
  ResponseMetrics,
  ExecutionTrace 
} from '../types';
import { CortexEncoder } from '../core/encoder';
import { CortexDecoder } from '../core/decoder';
import { loggingService } from '../../services/logging.service';
import { RetryWithBackoff } from '../../utils/retryWithBackoff';
import { calculateCost } from '../../utils/pricing';
import { BedrockModelFormatter } from '../utils/bedrockModelFormatter';
import { primitiveLearner } from '../learning/primitiveLearner';
import { ModelRouter, modelRouter } from './modelRouter';

export class CortexRelayEngine {
  private bedrockClient: BedrockRuntimeClient;
  private encoder: CortexEncoder;
  private decoder: CortexDecoder;
  private modelRouter: ModelRouter;
  private coreModelId: string;
  private executionTraces: ExecutionTrace[] = [];
  
  constructor() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    
    this.encoder = new CortexEncoder();
    this.decoder = new CortexDecoder();
    this.modelRouter = modelRouter; // Use singleton instance
    
    this.coreModelId = process.env.CORTEX_CORE_MODEL || 'anthropic.claude-3-5-haiku-20241022-v1:0';
  }

  
  /**
   * Execute the complete Cortex relay pipeline
   */
  public async execute(input: string, options?: {
    coreModel?: string;
    encoderModel?: string;
    decoderModel?: string;
    format?: string;
    style?: string;
  }): Promise<{ response: string; metrics: ResponseMetrics }> {
    const startTime = Date.now();
    this.executionTraces = [];
    
    try {
      // Step 1: Encode natural language to Cortex (with optional model override)
      this.addTrace('encoding_start');
      const cortexQuery = await this.encoder.encode(input, {
        compressionLevel: 'aggressive',
        preserveContext: true,
        modelOverride: options?.encoderModel
      });
      this.addTrace('encoding_complete');
      
      // Step 2: Route to appropriate model (or use override)
      this.addTrace('routing_start');
      const modelSelection = options?.coreModel 
        ? {
            modelId: options.coreModel,
            provider: 'bedrock' as const,
            capabilities: {
              maxTokens: 4000,
              supportedLanguages: ['en'],
              specializations: ['general'],
              costPerToken: 0.001,
              averageLatency: 1000
            },
            estimatedCost: 0.01,
            estimatedLatency: 1000,
            confidence: 1.0,
            reasoning: 'User specified model override'
          } as ModelSelection
        : {
            // Use configured core model instead of router selection
            modelId: this.coreModelId,
            provider: 'bedrock' as const,
            capabilities: {
              maxTokens: 4000,
              supportedLanguages: ['en'],
              specializations: ['general'],
              costPerToken: 0.003,
              averageLatency: 1500
            },
            estimatedCost: 0.015,
            estimatedLatency: 1500,
            confidence: 1.0,
            reasoning: 'Using configured core model'
          } as ModelSelection;
      this.addTrace('routing_complete', { model: modelSelection.modelId });
      
      // Step 3: Predict response quality if enabled
      if (process.env.CORTEX_RESPONSE_QUALITY_PREDICTION === 'true') {
        const qualityPrediction = await this.predictResponseQuality(cortexQuery, modelSelection);
        
        // Early termination if quality is predicted to be poor
        if (qualityPrediction.score < parseFloat(process.env.CORTEX_QUALITY_THRESHOLD || '0.85')) {
          if (process.env.CORTEX_QUALITY_EARLY_TERMINATION === 'true') {
            this.addTrace('early_termination', { 
              predictedScore: qualityPrediction.score,
              reason: qualityPrediction.reason 
            });
            
            // Return error response
            return {
              response: `Response quality predicted to be insufficient (${qualityPrediction.score.toFixed(2)}). ${qualityPrediction.reason}`,
              metrics: {
                ...this.calculateMetrics(input, cortexQuery, { frame: 'error', roles: {}, status: 'error' } as CortexResponse, modelSelection, startTime),
                earlyTermination: true,
                qualityPrediction
              }
            };
          }
        }
        
        this.addTrace('quality_prediction', qualityPrediction);
      }
      
      // Step 4: Check for parallel execution opportunities
      let cortexResponse: CortexResponse;
      
      if (process.env.CORTEX_DISTRIBUTED_EXECUTION === 'true' && this.canExecuteInParallel(cortexQuery)) {
        this.addTrace('parallel_execution_start');
        cortexResponse = await this.executeInParallel(cortexQuery, modelSelection);
        this.addTrace('parallel_execution_complete');
      } else {
        // Process with selected Bedrock model
        this.addTrace('processing_start');
        cortexResponse = await this.processWithBedrock(cortexQuery, modelSelection);
      }
      
      // Apply self-critique loop if enabled
      if (process.env.CORTEX_SELF_CRITIQUE_LOOP === 'true') {
        const maxIterations = parseInt(process.env.CORTEX_CRITIQUE_ITERATIONS || '2');
        cortexResponse = await this.applySelfCritique(
          cortexQuery, 
          cortexResponse, 
          modelSelection,
          maxIterations
        );
      }
      
      this.addTrace('processing_complete');
      
      // Step 4: Decode back to natural language (with optional model override)
      this.addTrace('decoding_start');
      const decodedResponse = await this.decoder.decode(cortexResponse, {
        format: (options?.format as any) || 'plain',
        style: (options?.style as any) || 'formal',
        modelOverride: options?.decoderModel
      });
      this.addTrace('decoding_complete');
      
      // Calculate metrics
      const metrics = this.calculateMetrics(
        input,
        cortexQuery,
        cortexResponse,
        modelSelection,
        startTime
      );
      
      // Learn new primitives if enabled
      if (process.env.CORTEX_DYNAMIC_PRIMITIVE_LEARNING === 'true') {
        const learnedPrimitives = await primitiveLearner.analyzeInteraction(
          input,
          cortexQuery,
          cortexResponse
        );
        
        if (learnedPrimitives.length > 0) {
          this.addTrace('primitive_learning', {
            learned: learnedPrimitives.length,
            primitives: learnedPrimitives.map(p => p.name)
          });
        }
      }
      
      // Log the complete execution
      this.logExecution(input, decodedResponse, metrics);
      
      return {
        response: decodedResponse,
        metrics
      };
    } catch (error) {
      loggingService.error('Cortex relay execution failed', { error, input });
      throw error;
    }
  }
  
  /**
   * Process Cortex query with AWS Bedrock
   */
  private async processWithBedrock(
    query: CortexQuery,
    modelSelection: ModelSelection
  ): Promise<CortexResponse> {
    const prompt = this.buildProcessingPrompt(query);
    
    // Use the formatter to create the correct request format for each model
    const isClaude = modelSelection.modelId.includes('anthropic.claude');
    
    const requestBody = BedrockModelFormatter.formatRequestBody({
      modelId: modelSelection.modelId,
      messages: [
        {
          role: 'user',
          content: isClaude ? `${this.buildSystemPrompt()}\n\n${prompt}` : prompt
        }
      ],
      systemPrompt: isClaude ? undefined : this.buildSystemPrompt(), // Skip system prompt for Claude
      maxTokens: 4000,
      temperature: modelSelection.modelId.includes('haiku') ? 0.3 : 0.5,
      topP: 0.95
    });
    
    const command = new InvokeModelCommand({
      modelId: modelSelection.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: requestBody
    });
    
    const response = await RetryWithBackoff.execute(
      async () => this.bedrockClient.send(command),
      {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2
      }
    );
    
    if (!response.success || !response.result) {
      throw new Error('Failed to process with Bedrock');
    }
    
    const responseBody = JSON.parse(new TextDecoder().decode(response.result.body));
    
    // Use the formatter to parse the response based on model type
    const cortexResponseText = BedrockModelFormatter.parseResponseBody(
      modelSelection.modelId,
      responseBody
    );
    
    // Parse the Cortex response
    return this.parseCortexResponse(cortexResponseText);
  }
  
  /**
   * Build the system prompt for core processing
   */
  private buildSystemPrompt(): string {
    return `You are a Cortex processor. Process structured queries and generate structured responses.

Rules:
1. Process the semantic intent
2. Generate valid JSON response
3. Use appropriate frames (answer, list, etc.)
4. Be concise and accurate

Response format:
{
  "frame": "answer",
  "roles": { "content": "your response" },
  "status": "success"
}`;
  }
  
  /**
   * Build the processing prompt
   */
  private buildProcessingPrompt(query: CortexQuery): string {
    // Simplify prompt for all Bedrock models to avoid "Malformed input request"
    const simplifiedQuery = {
      frame: query.frame,
      roles: query.roles,
      metadata: query.metadata?.trueCortexFormat ? { trueCortexFormat: query.metadata.trueCortexFormat } : {}
    };
    
    // For Claude models, use even simpler format
    const isClaude = process.env.CORTEX_CORE_MODEL?.includes('anthropic.claude');
    
    if (isClaude) {
      return `Process this query: ${query.roles?.content || query.frame || 'analyze data'}

Provide a structured analysis.`;
    }
    
    return `Process this Cortex query:

${JSON.stringify(simplifiedQuery)}

Generate a structured response.`;
  }
  
  /**
   * Check if query can be executed in parallel
   */
  private canExecuteInParallel(query: CortexQuery): boolean {
    // Check if query has multiple independent tasks
    if (!query.tasks || query.tasks.length <= 1) {
      return false;
    }
    
    // Check for inter-task dependencies
    const hasDependencies = query.tasks.some((task, index) => {
      const taskStr = JSON.stringify(task);
      // Check if this task references other tasks
      return taskStr.includes('$task_') && !taskStr.includes(`$task_${index}`);
    });
    
    // Can parallelize if no dependencies
    return !hasDependencies;
  }
  
  /**
   * Execute tasks in parallel
   */
  private async executeInParallel(
    query: CortexQuery,
    modelSelection: ModelSelection
  ): Promise<CortexResponse> {
    const maxParallelTasks = parseInt(process.env.CORTEX_PARALLEL_TASK_LIMIT || '10');
    const tasks = query.tasks || [];
    
    // Split tasks into batches
    const batches: any[][] = [];
    for (let i = 0; i < tasks.length; i += maxParallelTasks) {
      batches.push(tasks.slice(i, i + maxParallelTasks));
    }
    
    const allResults: any[] = [];
    
    // Process each batch in parallel
    for (const batch of batches) {
      const batchPromises = batch.map(async (task, index) => {
        // Create single-task query
        const singleTaskQuery: CortexQuery = {
          ...query,
          tasks: [task],
          metadata: {
            ...query.metadata,
            taskIndex: index,
            parallelExecution: true
          }
        };
        
        // Process individual task
        try {
          const response = await this.processWithBedrock(singleTaskQuery, modelSelection);
          return { success: true, response, taskIndex: index };
        } catch (error) {
          loggingService.warn('Parallel task execution failed', { taskIndex: index, error });
          return { success: false, error, taskIndex: index };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      allResults.push(...batchResults);
    }
    
    // Combine results
    return this.combineParallelResults(allResults, query);
  }
  
  /**
   * Combine results from parallel execution
   */
  private combineParallelResults(
    results: any[],
    _originalQuery: CortexQuery
  ): CortexResponse {
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    
    if (successfulResults.length === 0) {
      return {
        frame: 'error',
        roles: {
          code: 'PARALLEL_EXECUTION_FAILED',
          message: 'All parallel tasks failed',
          failures: failedResults.map(r => r.error?.message || 'Unknown error')
        },
        status: 'error'
      } as CortexResponse;
    }
    
    // Combine successful responses
    const combinedRoles: Record<string, any> = {};
    
    successfulResults.forEach((result, index) => {
      const taskKey = `task_${result.taskIndex || index}`;
      combinedRoles[taskKey] = result.response.roles || result.response;
    });
    
    // Add failed task indicators
    failedResults.forEach(result => {
      const taskKey = `task_${result.taskIndex}_error`;
      combinedRoles[taskKey] = {
        error: result.error?.message || 'Task execution failed'
      };
    });
    
    return {
      frame: 'answer',
      roles: combinedRoles,
      status: failedResults.length > 0 ? 'partial' : 'success',
      metadata: {
        parallelExecution: true,
        totalTasks: results.length,
        successfulTasks: successfulResults.length,
        failedTasks: failedResults.length
      }
    } as CortexResponse;
  }
  

  
  /**
   * Predict response quality before generating
   */
  private async predictResponseQuality(
    query: CortexQuery,
    modelSelection: ModelSelection
  ): Promise<{ score: number; reason: string; confidence: number }> {
    try {
      // Use a lightweight model for prediction
      const predictionModel = process.env.CORTEX_QUALITY_PREDICTOR_MODEL || 'amazon.nova-lite-v1:0';
      
      const predictionPrompt = `Predict the likely quality of response for this Cortex query:

QUERY:
${JSON.stringify(query, null, 2)}

MODEL: ${modelSelection.modelId}

Analyze:
1. Query complexity and clarity
2. Model capabilities match
3. Likely response completeness
4. Potential issues or limitations

Provide prediction in JSON:
{
  "score": 0.0-1.0,
  "reason": "brief explanation",
  "confidence": 0.0-1.0,
  "potentialIssues": ["issue1", "issue2"]
}`;
      
      const predictionRequest = BedrockModelFormatter.formatRequestBody({
        modelId: predictionModel,
        messages: [
          {
            role: 'user',
            content: predictionPrompt
          }
        ],
        systemPrompt: 'You are a quality predictor for Cortex responses. Analyze queries and predict response quality accurately.',
        maxTokens: 500,
        temperature: 0.3
      });
      
      const predictionResponse = await RetryWithBackoff.execute(
        () => this.bedrockClient.send(
          new InvokeModelCommand({
            modelId: predictionModel,
            body: JSON.stringify(predictionRequest),
            contentType: 'application/json',
            accept: 'application/json'
          })
        ),
        { maxRetries: 1, baseDelay: 500 }
      );
      
      if (!predictionResponse.success || !predictionResponse.result) {
        // Default to optimistic prediction if prediction fails
        return { score: 0.9, reason: 'Prediction unavailable', confidence: 0.5 };
      }
      
      const predictionBody = JSON.parse(new TextDecoder().decode(predictionResponse.result.body));
      const predictionText = BedrockModelFormatter.parseResponseBody(
        predictionModel,
        predictionBody
      );
      
      // Parse prediction
      try {
        const jsonMatch = predictionText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            score: parsed.score || 0.8,
            reason: parsed.reason || 'No specific reason provided',
            confidence: parsed.confidence || 0.7
          };
        }
      } catch (error) {
        loggingService.warn('Failed to parse quality prediction', { error });
      }
      
      return { score: 0.8, reason: 'Default prediction', confidence: 0.6 };
    } catch (error) {
      loggingService.warn('Quality prediction failed', { error });
      return { score: 0.85, reason: 'Prediction error', confidence: 0.5 };
    }
  }
  
  /**
   * Apply self-critique loop to improve response quality
   */
  private async applySelfCritique(
    query: CortexQuery,
    initialResponse: CortexResponse,
    modelSelection: ModelSelection,
    maxIterations: number
  ): Promise<CortexResponse> {
    let currentResponse = initialResponse;
    let iteration = 0;
    
    while (iteration < maxIterations) {
      this.addTrace(`critique_iteration_${iteration}_start`);
      
      // Build critique prompt
      const critiquePrompt = this.buildCritiquePrompt(query, currentResponse);
      
      // Get critique from LLM
      const critiqueRequest = BedrockModelFormatter.formatRequestBody({
        modelId: modelSelection.modelId,
        messages: [
          {
            role: 'user',
            content: critiquePrompt
          }
        ],
        systemPrompt: this.buildCritiqueSystemPrompt(),
        maxTokens: 1000,
        temperature: 0.3
      });
      
      const critiqueResponse = await RetryWithBackoff.execute(
        () => this.bedrockClient.send(
          new InvokeModelCommand({
            modelId: modelSelection.modelId,
            body: JSON.stringify(critiqueRequest),
            contentType: 'application/json',
            accept: 'application/json'
          })
        ),
        { maxRetries: 2, baseDelay: 1000 }
      );
      
      if (!critiqueResponse.success || !critiqueResponse.result) {
        break; // Skip critique if it fails
      }
      
      const critiqueBody = JSON.parse(new TextDecoder().decode(critiqueResponse.result.body));
      const critiqueText = BedrockModelFormatter.parseResponseBody(
        modelSelection.modelId,
        critiqueBody
      );
      
      // Parse critique result
      const critique = this.parseCritique(critiqueText);
      
      // If response is good enough, stop
      if (critique.qualityScore >= (parseFloat(process.env.CORTEX_QUALITY_THRESHOLD || '0.85'))) {
        this.addTrace(`critique_iteration_${iteration}_passed`, { score: critique.qualityScore });
        break;
      }
      
      // Apply improvements
      if (critique.improvements && critique.improvements.length > 0) {
        currentResponse = await this.applyImprovements(
          query,
          currentResponse,
          critique.improvements,
          modelSelection
        );
      }
      
      this.addTrace(`critique_iteration_${iteration}_complete`, { 
        score: critique.qualityScore,
        improvements: critique.improvements?.length || 0
      });
      
      iteration++;
    }
    
    return currentResponse;
  }
  
  /**
   * Build critique prompt
   */
  private buildCritiquePrompt(query: CortexQuery, response: CortexResponse): string {
    return `Analyze the following Cortex query and response for quality and completeness:

ORIGINAL QUERY:
${JSON.stringify(query, null, 2)}

GENERATED RESPONSE:
${JSON.stringify(response, null, 2)}

Evaluate the response on these criteria:
1. Completeness: Does it fully address the query?
2. Accuracy: Is the information correct and relevant?
3. Structure: Is the Cortex format properly used?
4. Efficiency: Is it concise without losing meaning?
5. Semantic Clarity: Are the roles and frames appropriate?

Provide your analysis in JSON format:
{
  "qualityScore": 0.0-1.0,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "improvements": ["specific improvement 1", "specific improvement 2"],
  "recommendRefinement": true/false
}`;
  }
  
  /**
   * Build critique system prompt
   */
  private buildCritiqueSystemPrompt(): string {
    return `You are a Cortex Quality Analyzer. Your role is to evaluate Cortex responses for quality, completeness, and semantic accuracy.

EVALUATION CRITERIA:
1. Completeness (0.3 weight): Response fully addresses all aspects of the query
2. Accuracy (0.3 weight): Information is correct and relevant
3. Structure (0.2 weight): Proper use of Cortex frames and roles
4. Efficiency (0.1 weight): Concise without losing meaning
5. Semantic Clarity (0.1 weight): Clear and unambiguous semantics

SCORING:
- 0.9-1.0: Excellent, no refinement needed
- 0.8-0.9: Good, minor improvements possible
- 0.7-0.8: Adequate, should be refined
- Below 0.7: Poor, requires significant refinement

Be critical but fair. Focus on actionable improvements.`;
  }
  
  /**
   * Parse critique response
   */
  private parseCritique(text: string): {
    qualityScore: number;
    strengths?: string[];
    weaknesses?: string[];
    improvements?: string[];
    recommendRefinement: boolean;
  } {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          qualityScore: parsed.qualityScore || 0.5,
          strengths: parsed.strengths,
          weaknesses: parsed.weaknesses,
          improvements: parsed.improvements,
          recommendRefinement: parsed.recommendRefinement !== false
        };
      }
    } catch (error) {
      loggingService.warn('Failed to parse critique', { error });
    }
    
    return {
      qualityScore: 0.7,
      recommendRefinement: false
    };
  }
  
  /**
   * Apply improvements to response
   */
  private async applyImprovements(
    query: CortexQuery,
    response: CortexResponse,
    improvements: string[],
    modelSelection: ModelSelection
  ): Promise<CortexResponse> {
    const refinementPrompt = `Refine the following Cortex response based on these improvements:

ORIGINAL QUERY:
${JSON.stringify(query, null, 2)}

CURRENT RESPONSE:
${JSON.stringify(response, null, 2)}

REQUIRED IMPROVEMENTS:
${improvements.map((imp, i) => `${i + 1}. ${imp}`).join('\n')}

Generate an improved Cortex response that addresses these issues:`;
    
    const refinementRequest = BedrockModelFormatter.formatRequestBody({
      modelId: modelSelection.modelId,
      messages: [
        {
          role: 'user',
          content: refinementPrompt
        }
      ],
      systemPrompt: this.buildSystemPrompt(),
      maxTokens: 2000,
      temperature: 0.5
    });
    
    const refinementResponse = await RetryWithBackoff.execute(
      () => this.bedrockClient.send(
        new InvokeModelCommand({
          modelId: modelSelection.modelId,
          body: JSON.stringify(refinementRequest),
          contentType: 'application/json',
          accept: 'application/json'
        })
      ),
      { maxRetries: 2, baseDelay: 1000 }
    );
    
    if (!refinementResponse.success || !refinementResponse.result) {
      return response; // Return original if refinement fails
    }
    
    const refinementBody = JSON.parse(new TextDecoder().decode(refinementResponse.result.body));
    const refinedText = BedrockModelFormatter.parseResponseBody(
      modelSelection.modelId,
      refinementBody
    );
    
    return this.parseCortexResponse(refinedText);
  }
  
  /**
   * Parse Cortex response from LLM output
   */
  private parseCortexResponse(text: string): CortexResponse {
    try {
      // Extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Ensure it has required fields
        return {
          frame: parsed.frame || 'answer',
          roles: parsed.roles || { content: text },
          status: parsed.status || 'success',
          metadata: parsed.metadata
        } as CortexResponse;
      }
      
      // Fallback to basic response
      return {
        frame: 'answer',
        roles: { content: text },
        status: 'success'
      } as CortexResponse;
    } catch (error) {
      loggingService.error('Failed to parse Cortex response', { text, error });
      
      return {
        frame: 'error',
        roles: {
          code: 'PARSE_ERROR',
          message: 'Failed to parse Cortex response'
        },
        status: 'error'
      } as CortexResponse;
    }
  }
  
  /**
   * Calculate execution metrics
   */
  private calculateMetrics(
    originalInput: string,
    cortexQuery: CortexQuery,
    cortexResponse: CortexResponse,
    modelSelection: ModelSelection,
    startTime: number
  ): ResponseMetrics {
    const originalTokens = this.estimateTokens(originalInput);
    const cortexTokens = this.estimateTokens(JSON.stringify(cortexQuery));
    const responseTokens = this.estimateTokens(JSON.stringify(cortexResponse));
    
    const tokenReduction = 1 - (cortexTokens / originalTokens);
    const processingTime = Date.now() - startTime;
    
    // Calculate cost savings
    const originalCost = calculateCost(originalTokens, responseTokens, 'aws-bedrock', this.coreModelId);
    const optimizedCost = calculateCost(cortexTokens, responseTokens, 'aws-bedrock', modelSelection.modelId);
    
    const costSavings = 1 - (optimizedCost / originalCost);
    
    return {
      originalTokens,
      optimizedTokens: cortexTokens,
      tokenReduction,
      processingTime,
      costSavings,
      modelUsed: modelSelection.modelId,
      cacheHit: false // Will be implemented with caching system
    };
  }
  
  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Add execution trace
   */
  private addTrace(step: string, details?: any): void {
    this.executionTraces.push({
      step,
      timestamp: Date.now(),
      duration: this.executionTraces.length > 0 
        ? Date.now() - this.executionTraces[this.executionTraces.length - 1].timestamp 
        : 0,
      details
    });
  }
  
  /**
   * Log execution details
   */
  private logExecution(
    input: string,
    output: string,
    metrics: ResponseMetrics
  ): void {
    loggingService.info('Cortex relay execution completed', {
      inputLength: input.length,
      outputLength: output.length,
      metrics,
      traces: this.executionTraces,
      tokenReduction: `${(metrics.tokenReduction * 100).toFixed(1)}%`,
      costSavings: `${(metrics.costSavings * 100).toFixed(1)}%`,
      executionTime: `${metrics.processingTime}ms`
    });
  }
  
  /**
   * Execute with custom model selection
   */
  public async executeWithModel(
    input: string,
    modelIdOrOptions: string | {
      coreModel?: string;
      encoderModel?: string;
      decoderModel?: string;
      format?: string;
      style?: string;
    }
  ): Promise<{ response: string; metrics: ResponseMetrics }> {
    // Handle backward compatibility - if string, use as core model
    const options = typeof modelIdOrOptions === 'string' 
      ? { coreModel: modelIdOrOptions }
      : modelIdOrOptions;
    
    // Delegate to main execute method with options
    return this.execute(input, options);
  }
  
  /**
   * Execute in streaming mode
   */
  public async *streamExecute(input: string): AsyncGenerator<string> {
    // Encode
    const cortexQuery = await this.encoder.encode(input);
    
    // Route
    const modelSelection = await this.modelRouter.selectModel(cortexQuery);
    
    // Process
    const cortexResponse = await this.processWithBedrock(cortexQuery, modelSelection);
    
    // Stream decode
    const decoder = new CortexDecoder();
    yield* decoder.streamDecode(cortexResponse);
  }
}

/**
 * Singleton instance for easy access
 */
export const cortexRelay = new CortexRelayEngine();
