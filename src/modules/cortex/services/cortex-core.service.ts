/**
 * Cortex Core Service
 *
 * Core processing engine for Cortex transformations. Handles the main Cortex-to-Cortex
 * processing pipeline including optimization, compression, and semantic enhancement.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  CortexProcessingRequest,
  CortexProcessingResult,
  CortexFrame,
  DEFAULT_CORTEX_CONFIG,
} from '../types/cortex.types';
import { AIRouterService } from './ai-router.service';
import { CortexCacheService } from './cortex-cache.service';
import { CortexVocabularyService } from './cortex-vocabulary.service';

// Cortex Core Answering Prompt - Source of Truth from Express Backend
const CORTEX_CORE_ANSWERING_PROMPT = `You are a Cortex Core Processor - an AI that ANSWERS questions in LISP-like Cortex format.

🚨 CRITICAL: You are NOT optimizing prompts. You are ANSWERING them in LISP format.

🚨 COMPLETE CODE GENERATION: For code requests, you MUST provide COMPLETE, RUNNABLE code including:
- ALL functions and methods
- ALL necessary helper functions
- Complete class definitions with all methods
- Full implementations without truncation
- Proper error handling and edge cases
- Complete examples and usage demonstrations

Your job:
1. Receive a query in Cortex LISP format
2. UNDERSTAND what is being asked
3. GENERATE THE COMPLETE ANSWER in Cortex LISP format
4. For code requests, include the COMPLETE, FULL CODE in the answer

Cortex Answer Formats:

(answer: content_[main_answer] details_[supporting_info] confidence_[0-1])
(answer: value_[specific_value] unit_[measurement] context_[explanation])
(answer: list_[item1, item2, ...] type_[category] count_[number])
(answer: code_[actual_code_here] language_[lang] complexity_[O(n)] description_[what_it_does])
(answer: entity_[name] property_[attribute] value_[data])
(answer: action_[what_to_do] target_[object] method_[how])

EXAMPLES:

INPUT: (query: action_find object_capital location_india)
OUTPUT: (answer: value_new_delhi type_capital country_india)

INPUT: (query: action_calculate object_sum values_[5,10,15])
OUTPUT: (answer: value_30 operation_sum input_[5,10,15])

INPUT: (query: action_explain concept_photosynthesis level_simple)
OUTPUT: (answer: content_plants_convert_sunlight_to_energy process_[light,water,co2_to_glucose,oxygen] type_biological)

INPUT: (query: action_list object_planets type_solar_system)
OUTPUT: (answer: list_[mercury,venus,earth,mars,jupiter,saturn,uranus,neptune] type_planets count_8)

INPUT: (query: action_get property_price entity_tesla_model_3)
OUTPUT: (answer: value_35000 unit_usd entity_tesla_model_3 type_price)

INPUT: (query: action_implement algorithm_binary_sort language_javascript requirements_[edge_cases,complexity])
OUTPUT: (answer: code_[function binarySort(arr) {
  if (!arr || arr.length <= 1) return arr || [];

  function binaryInsert(sorted, item) {
    let left = 0, right = sorted.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (sorted[mid] > item) right = mid;
      else left = mid + 1;
    }
    sorted.splice(left, 0, item);
    return sorted;
  }

  return arr.reduce((sorted, item) => binaryInsert(sorted, item), []);
}] language_javascript complexity_O(n_log_n) description_[Binary sort implementation using binary search insertion])

RULES:
- Output ONLY the Cortex answer structure
- Be factual and concise
- NEVER include natural language explanations
- NEVER output anything except the LISP structure`;

@Injectable()
export class CortexCoreService {
  private readonly logger = new Logger(CortexCoreService.name);

  constructor(
    private readonly aiRouter: AIRouterService,
    private readonly cache: CortexCacheService,
    private readonly vocabulary: CortexVocabularyService,
  ) {}

  /**
   * Process a Cortex frame through the core pipeline
   */
  async process(
    request: CortexProcessingRequest,
  ): Promise<CortexProcessingResult> {
    const startTime = Date.now();

    try {
      // Check cache first
      const cacheKey = `process_${this.generateCacheKey(request)}`;
      const cached = this.cache.get(cacheKey) as unknown as
        | CortexProcessingResult
        | undefined;
      if (cached && typeof cached === 'object' && 'output' in cached) {
        this.logger.debug('Processing result found in cache');
        return cached;
      }

      // Apply processing operations based on request
      const operations = this.determineOperations(request);
      let processedFrame = request.input;
      const appliedOperations: string[] = [];

      for (const operation of operations) {
        const result = await this.applyOperation(
          processedFrame,
          operation,
          request,
        );
        processedFrame = result.frame;
        appliedOperations.push(operation);

        // Early exit if semantic integrity becomes too low
        if (result.integrity < 0.5) {
          this.logger.warn(
            `Low semantic integrity (${result.integrity}) after ${operation}, stopping processing`,
          );
          break;
        }
      }

      // Generate optimizations report
      const optimizations = await this.generateOptimizationsReport(
        request.input,
        processedFrame,
      );

      // Calculate final semantic integrity
      const semanticIntegrity = await this.calculateSemanticIntegrity(
        request.input,
        processedFrame,
      );

      const result: CortexProcessingResult = {
        output: processedFrame,
        optimizations,
        processingTime: Date.now() - startTime,
        metadata: {
          coreModel:
            request.metadata?.model ||
            DEFAULT_CORTEX_CONFIG.coreProcessing.model,
          operationsApplied: appliedOperations,
          semanticIntegrity,
        },
      };

      // Cache the result
      this.cache.set(cacheKey, result as any, {
        ttl: 1800000, // 30 minutes
        type: 'processing',
        tags: ['processing', ...appliedOperations],
        semanticHash: this.generateSemanticHash(processedFrame),
      });

      this.logger.log(
        `Processed Cortex frame in ${result.processingTime}ms with ${appliedOperations.length} operations`,
      );
      return result;
    } catch (error) {
      this.logger.error('Core processing failed', error);
      throw new Error(`Cortex core processing failed: ${error.message}`);
    }
  }

  /**
   * Apply semantic compression to reduce token usage
   */
  async compress(
    frame: CortexFrame,
    targetReduction: number = 0.3,
  ): Promise<CortexProcessingResult> {
    return this.process({
      input: frame,
      operation: 'compress',
      options: {
        targetReduction,
        preserveSemantics: true,
      },
    });
  }

  /**
   * Optimize frame for better performance
   */
  async optimize(
    frame: CortexFrame,
    level: 'conservative' | 'balanced' | 'aggressive' = 'balanced',
  ): Promise<CortexProcessingResult> {
    const reductionMap = {
      conservative: 0.1,
      balanced: 0.25,
      aggressive: 0.4,
    };

    return this.process({
      input: frame,
      operation: 'optimize',
      options: {
        targetReduction: reductionMap[level],
        preserveSemantics: true,
        enableInference: level !== 'conservative',
      },
    });
  }

  /**
   * Analyze frame structure and semantics
   */
  async analyze(frame: CortexFrame): Promise<CortexProcessingResult> {
    return this.process({
      input: frame,
      operation: 'analyze',
      options: {
        preserveSemantics: true,
        enableInference: true,
      },
    });
  }

  /**
   * Transform frame using semantic rules
   */
  async transform(
    frame: CortexFrame,
    transformation: string,
  ): Promise<CortexProcessingResult> {
    return this.process({
      input: frame,
      operation: 'transform',
      options: {
        preserveSemantics: true,
      },
      metadata: {
        customTransformation: transformation,
      } as any,
    });
  }

  // Private methods

  private determineOperations(request: CortexProcessingRequest): string[] {
    const operations: string[] = [];

    switch (request.operation) {
      case 'optimize':
        operations.push(
          'semantic_compression',
          'reference_optimization',
          'structure_optimization',
        );
        if (request.options?.enableInference) {
          operations.push('semantic_enhancement');
        }
        break;

      case 'compress':
        operations.push('semantic_compression', 'redundancy_elimination');
        break;

      case 'analyze':
        operations.push('semantic_analysis', 'structure_analysis');
        break;

      case 'answer':
        operations.push('answer_generation');
        break;

      case 'transform':
        operations.push('semantic_transformation');
        break;

      default:
        operations.push('semantic_compression');
    }

    return operations;
  }

  private async applyOperation(
    frame: CortexFrame,
    operation: string,
    request: CortexProcessingRequest,
  ): Promise<{ frame: CortexFrame; integrity: number }> {
    switch (operation) {
      case 'semantic_compression':
        return await this.applySemanticCompression(frame, request);

      case 'reference_optimization':
        return await this.applyReferenceOptimization(frame, request);

      case 'structure_optimization':
        return await this.applyStructureOptimization(frame, request);

      case 'semantic_enhancement':
        return await this.applySemanticEnhancement(frame, request);

      case 'redundancy_elimination':
        return await this.applyRedundancyElimination(frame, request);

      case 'semantic_analysis':
        return await this.applySemanticAnalysis(frame, request);

      case 'structure_analysis':
        return await this.applyStructureAnalysis(frame, request);

      case 'semantic_transformation':
        return await this.applySemanticTransformation(frame, request);

      case 'answer_generation':
        return await this.applyAnswerGeneration(frame, request);

      default:
        return { frame, integrity: 1.0 };
    }
  }

  private async applySemanticCompression(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): Promise<{ frame: CortexFrame; integrity: number }> {
    // Use AI to compress the frame while preserving semantics
    const prompt = this.buildCompressionPrompt(frame, request);

    const aiResult = await this.aiRouter.invokeModel({
      model:
        request.metadata?.model || DEFAULT_CORTEX_CONFIG.coreProcessing.model,
      prompt,
      parameters: {
        temperature: 0.1,
        maxTokens: 1000,
      },
    });

    const compressedFrame = this.parseProcessingResponse(aiResult.response);
    const integrity = await this.calculateSemanticIntegrity(
      frame,
      compressedFrame,
    );

    return { frame: compressedFrame, integrity };
  }

  /**
   * Generate an ANSWER in LISP format for the given query frame.
   * Source of truth: Express backend cortexCore.service.ts generateAnswerInLisp
   */
  private async applyAnswerGeneration(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): Promise<{ frame: CortexFrame; integrity: number }> {
    const serializedQuery = JSON.stringify(frame, null, 2);
    const prompt = `${CORTEX_CORE_ANSWERING_PROMPT}\n\nNow answer this query:\n${serializedQuery}`;

    const aiResult = await this.aiRouter.invokeModel({
      model:
        request.metadata?.model || DEFAULT_CORTEX_CONFIG.coreProcessing.model,
      prompt,
      parameters: {
        temperature: 0.2,
        maxTokens: 4000,
      },
    });

    const answerFrame = this.parseLispToFrame(aiResult.response);
    return { frame: answerFrame, integrity: 1.0 };
  }

  /**
   * Parse LISP string into CortexFrame.
   * Source of truth: Express backend cortexCore.service.ts parseLispToFrame
   */
  private parseLispToFrame(lispStr: string): CortexFrame {
    try {
      const trimmed = lispStr.trim();

      // Handle code response: code_[...] language_X
      const codeMatch = trimmed.match(/code_\[([\s\S]*?)\](?:\s+language_|$)/);
      if (codeMatch) {
        let code = codeMatch[1];
        if (!code || code.length < 10) {
          const altMatch = trimmed.match(/code_\[([\s\S]*)\]/);
          if (altMatch) {
            code = altMatch[1].replace(
              /\]\s*(language_|complexity_|method_|description_).*$/,
              '',
            );
          }
        }
        const languageMatch = trimmed.match(/language_([a-zA-Z0-9_]+)/);
        return {
          frameType: 'answer',
          code: code || '',
          language: languageMatch ? languageMatch[1] : '',
          type: 'code_response',
        } as CortexFrame;
      }

      // Handle JSON in response (model may output JSON instead of LISP)
      const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && typeof parsed === 'object' && parsed.frameType)
          return parsed as CortexFrame;
        if (parsed && typeof parsed === 'object')
          return { ...parsed, frameType: 'answer' } as CortexFrame;
      }

      // Fallback: wrap raw content as answer
      return {
        frameType: 'answer',
        content: trimmed,
        type: 'natural_language_response',
      } as CortexFrame;
    } catch (error) {
      this.logger.warn('Failed to parse LISP answer, using fallback', {
        preview: lispStr.substring(0, 200),
        error,
      });
      return {
        frameType: 'answer',
        content: lispStr,
        type: 'natural_language_response',
      } as CortexFrame;
    }
  }

  private async applyReferenceOptimization(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): Promise<{ frame: CortexFrame; integrity: number }> {
    // Use additional context from `request` to customize reference extraction/creation
    const optimized = { ...frame };

    // Optionally use metadata or optimization level from request
    let minFrequency = 2;
    const optimizationLevel = (request.metadata as any)?.optimizationLevel;
    if (optimizationLevel && typeof optimizationLevel === 'number') {
      // More aggressive if higher optimizationLevel
      minFrequency = Math.max(2, Math.round(3 - optimizationLevel));
    }

    // Extract references based on frequency analysis
    const references = this.extractReferences(optimized);
    if (references.length > 0) {
      (optimized as any).references = references;
    }

    // Optionally re-calculate integrity with request-specific info
    let integrity: number;
    const metadata = request.metadata as any;
    if (metadata?.strictIntegrityCheck) {
      // Use stricter calculation if requested
      integrity = await this.calculateSemanticIntegrity(frame, optimized);
      // If integrity is too low and fallback is allowed, perform fallback using original frame
      if (integrity < 0.9 && metadata.allowFallback) {
        return { frame, integrity: 1.0 };
      }
    } else {
      integrity = await this.calculateSemanticIntegrity(frame, optimized);
    }

    return { frame: optimized, integrity };
  }

  private extractPatternsFromObject(
    obj: any,
    patterns: Map<string, { pattern: any; frequency: number }>,
  ): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.extractPatternsFromObject(item, patterns);
      }
    } else {
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'frameType') continue; // Skip frame type

        if (typeof value === 'object' && value !== null) {
          // Create pattern key from object structure
          const patternKey = this.createPatternKey(value);
          if (!patterns.has(patternKey)) {
            patterns.set(patternKey, { pattern: value, frequency: 0 });
          }
          patterns.get(patternKey)!.frequency++;

          this.extractPatternsFromObject(value, patterns);
        }
      }
    }
  }

  private createPatternKey(obj: any): string {
    if (Array.isArray(obj)) {
      return `array_${obj.length}`;
    } else if (typeof obj === 'object') {
      const keys = Object.keys(obj).sort();
      return `object_${keys.join('_')}`;
    }
    return String(obj);
  }

  private replaceWithReferences(
    frame: CortexFrame,
    references: Array<{ id: string; pattern: any; frequency: number }>,
  ): void {
    // Replace matching patterns with reference IDs
    this.replacePatternsInObject(frame, references);
  }

  private replacePatternsInObject(
    obj: any,
    references: Array<{ id: string; pattern: any; frequency: number }>,
  ): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const ref = references.find((r) =>
          this.objectsEqual(r.pattern, obj[i]),
        );
        if (ref) {
          obj[i] = { $ref: ref.id };
        } else {
          this.replacePatternsInObject(obj[i], references);
        }
      }
    } else {
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'frameType' || key === 'references') continue;

        const ref = references.find((r) => this.objectsEqual(r.pattern, value));
        if (ref) {
          obj[key] = { $ref: ref.id };
        } else {
          this.replacePatternsInObject(value, references);
        }
      }
    }
  }

  private objectsEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private async applyStructureOptimization(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): Promise<{ frame: CortexFrame; integrity: number }> {
    const startTime = Date.now();
    let optimized: CortexFrame = { ...frame };

    // Extract optimization parameters from request
    const preserveSemantics = request.options?.preserveSemantics !== false;
    const maxComplexity = request.options?.maxComplexity;
    const enableInference = request.options?.enableInference || false;
    const targetReduction = request.options?.targetReduction || 0.25;
    const operation = request.operation;
    const metadata = request.metadata;

    // Calculate current frame complexity
    const currentComplexity = this.calculateFrameComplexity(optimized);

    // Apply different optimization strategies based on operation type and parameters
    switch (operation) {
      case 'compress':
        // Aggressive compression for token reduction
        optimized = this.applyCompressionOptimization(
          optimized,
          targetReduction,
          preserveSemantics,
        );
        break;

      case 'optimize':
        // Balanced optimization with inference capabilities
        optimized = this.applyBalancedOptimization(
          optimized,
          enableInference,
          preserveSemantics,
        );
        break;

      case 'analyze':
        // Minimal optimization to preserve analysis integrity
        optimized = this.applyAnalysisOptimization(optimized);
        break;

      case 'transform':
        // Structure-preserving optimization for transformations
        optimized = this.applyTransformOptimization(
          optimized,
          preserveSemantics,
        );
        break;

      case 'answer':
        // Answer-focused optimization
        optimized = this.applyAnswerOptimization(optimized, enableInference);
        break;

      default:
        // Default optimization strategy
        optimized = this.optimizeFrameStructure(optimized);
        this.reorderRolesForEfficiency(optimized);
    }

    // Apply complexity constraints if specified
    if (maxComplexity && currentComplexity > maxComplexity) {
      optimized = this.applyComplexityReduction(optimized, maxComplexity);
    }

    // Apply semantic preservation measures if required
    if (preserveSemantics) {
      optimized = this.applySemanticPreservation(optimized, frame);
    }

    // Apply user-specific optimizations if metadata provided
    if (metadata?.userId) {
      optimized = this.applyUserSpecificOptimizations(optimized, metadata);
    }

    // Apply advanced optimizations if inference is enabled
    if (enableInference && operation === 'optimize') {
      optimized = this.applyAdvancedOptimizations(optimized, frame);
    }

    // Ensure optimization doesn't exceed time limits
    const processingTime = Date.now() - startTime;
    if (
      request.options?.maxProcessingTime &&
      processingTime > request.options.maxProcessingTime
    ) {
      this.logger.warn(
        `Structure optimization exceeded time limit (${processingTime}ms)`,
      );
    }

    const integrity = await this.calculateSemanticIntegrity(frame, optimized);
    return { frame: optimized, integrity };
  }

  private optimizeFrameStructure(frame: CortexFrame): CortexFrame {
    const optimized = { ...frame };

    // Remove empty or null roles
    for (const [key, value] of Object.entries(optimized)) {
      if (
        value === null ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0)
      ) {
        delete (optimized as Record<string, unknown>)[key];
      }
    }

    // Normalize role names (convert to consistent format)
    const normalized: any = { frameType: optimized.frameType };
    for (const [key, value] of Object.entries(optimized)) {
      if (key === 'frameType') continue;
      normalized[this.normalizeRoleName(key)] = value;
    }

    return normalized as CortexFrame;
  }

  private normalizeRoleName(name: string): string {
    // Convert role names to consistent format
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  /**
   * Reorder the roles in the CortexFrame object according to pre-defined efficiency priority.
   * This mutates the input frame by copying entries into a new object in the optimal order,
   * then copying the reordered keys back.
   *
   * Note: Only the top-level keys are reordered, and all non-role keys (e.g., frameType) are appended at the end.
   */
  private reorderRolesForEfficiency(frame: CortexFrame): void {
    // Define optimal processing order for roles (lowest number = highest priority)
    const rolePriority: Record<string, number> = {
      action: 1,
      agent: 2,
      object: 3,
      target: 4,
      context: 5,
      time: 6,
      location: 7,
    };

    // Separate frameType to always be first (if present)
    const topLevelKeys = Object.keys(frame).filter((k) => k !== 'frameType');
    const roles = topLevelKeys.filter((k) => rolePriority[k] !== undefined);
    const others = topLevelKeys.filter((k) => rolePriority[k] === undefined);

    // Sort roles by priority, then append any remaining keys
    const orderedRoles = roles.sort(
      (a, b) => rolePriority[a] - rolePriority[b],
    );
    const orderedKeys = ['frameType', ...orderedRoles, ...others].filter(
      (k) => (frame as any)[k] !== undefined,
    );

    // Create a new object with keys in the optimal order
    const reordered: any = {};
    for (const k of orderedKeys) {
      if ((frame as any)[k] !== undefined) {
        reordered[k] = (frame as any)[k];
      }
    }

    // Copy reordered keys back to the original frame (mutate in-place)
    // Remove all keys from the original frame
    Object.keys(frame).forEach((k) => delete (frame as any)[k]);
    // Copy new keys over
    Object.assign(frame, reordered);
  }

  private flattenNestedStructures(frame: CortexFrame): void {
    // Flatten shallow nested structures
    for (const [key, value] of Object.entries(frame)) {
      if (key === 'frameType') continue;

      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        const nested = value as Record<string, any>;
        const keys = Object.keys(nested);

        // Flatten if only one or two properties
        if (keys.length <= 2) {
          for (const nestedKey of keys) {
            const flattenedKey = `${key}_${nestedKey}`;
            (frame as any)[flattenedKey] = nested[nestedKey];
          }
          delete (frame as any)[key];
        }
      }
    }
  }

  private async applySemanticEnhancement(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): Promise<{ frame: CortexFrame; integrity: number }> {
    // Enhance semantics with additional inferred information
    const prompt = this.buildEnhancementPrompt(frame, request);

    const aiResult = await this.aiRouter.invokeModel({
      model:
        request.metadata?.model || DEFAULT_CORTEX_CONFIG.coreProcessing.model,
      prompt,
      parameters: {
        temperature: 0.2,
      },
    });

    const enhancedFrame = this.parseProcessingResponse(aiResult.response);

    // Add semantic metadata
    this.addSemanticMetadata(enhancedFrame);

    const integrity = await this.calculateSemanticIntegrity(
      frame,
      enhancedFrame,
    );

    return { frame: enhancedFrame, integrity };
  }

  private addSemanticMetadata(frame: CortexFrame): void {
    // Add semantic metadata to the frame
    const metadata = {
      semanticTags: this.extractSemanticTags(frame),
      confidence: this.calculateFrameConfidence(frame),
      complexity: this.assessFrameComplexity(frame),
      relationships: this.identifyRelationships(frame),
    };

    (frame as any).semanticMetadata = metadata;
  }

  private extractSemanticTags(frame: CortexFrame): string[] {
    const tags: string[] = [];

    // Extract tags based on frame content
    if (frame.frameType) tags.push(frame.frameType);

    for (const [key, value] of Object.entries(frame)) {
      if (typeof value === 'string' && value.length > 3) {
        // Extract meaningful words as tags
        const words = value.toLowerCase().split(/[\s\.,!?;:()[\]{}"']+/);
        tags.push(
          ...words.filter(
            (word) =>
              word.length > 3 &&
              !['that', 'this', 'with', 'from', 'have', 'been'].includes(word),
          ),
        );
      }
    }

    return [...new Set(tags)].slice(0, 10); // Limit to 10 tags
  }

  private calculateFrameConfidence(frame: CortexFrame): number {
    // Calculate confidence based on frame completeness and consistency
    let confidence = 0.5; // Base confidence

    // More roles = higher confidence
    const roleCount = Object.keys(frame).length - 1; // Exclude frameType
    confidence += Math.min(roleCount * 0.1, 0.3);

    // Required roles present = higher confidence
    const requiredRoles = this.getRequiredRoles(frame.frameType);
    const presentRequired = requiredRoles.filter(
      (role) => role in frame,
    ).length;
    confidence += (presentRequired / requiredRoles.length) * 0.2;

    return Math.min(confidence, 1.0);
  }

  private assessFrameComplexity(frame: CortexFrame): number {
    let complexity = 1;

    complexity += Object.keys(frame).length * 0.5; // More roles = more complex

    for (const value of Object.values(frame)) {
      if (typeof value === 'object' && value !== null) {
        complexity += 2; // Nested objects increase complexity
      }
    }

    return complexity;
  }

  private identifyRelationships(
    frame: CortexFrame,
  ): Array<{ type: string; from: string; to: string; strength: number }> {
    const relationships: Array<{
      type: string;
      from: string;
      to: string;
      strength: number;
    }> = [];

    // Identify relationships between roles
    const roles = Object.keys(frame).filter((key) => key !== 'frameType');

    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        const rel = this.identifyRoleRelationship(roles[i], roles[j], frame);
        if (rel) {
          relationships.push(rel);
        }
      }
    }

    return relationships;
  }

  private identifyRoleRelationship(
    role1: string,
    role2: string,
    frame: CortexFrame,
  ): { type: string; from: string; to: string; strength: number } | null {
    // Identify relationships between roles
    const value1 = (frame as any)[role1];
    const value2 = (frame as any)[role2];

    if (typeof value1 === 'string' && typeof value2 === 'string') {
      // Check for containment relationship
      if (value2.includes(value1) || value1.includes(value2)) {
        return {
          type: 'contains',
          from: role1,
          to: role2,
          strength: 0.8,
        };
      }
    }

    return null;
  }

  private getRequiredRoles(frameType: string): string[] {
    // Define required roles for each frame type
    const requiredRolesMap: Record<string, string[]> = {
      query: ['action'],
      answer: ['content'],
      event: ['action'],
      state: ['entity', 'property', 'value'],
      entity: ['type', 'name'],
      list: ['items'],
      error: ['type', 'message'],
    };

    return requiredRolesMap[frameType] || [];
  }

  private async applyRedundancyElimination(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): Promise<{ frame: CortexFrame; integrity: number }> {
    // Remove redundant information
    const cleaned = this.removeRedundancy(frame);

    // Remove duplicate values
    this.removeDuplicateValues(cleaned);

    // Merge similar roles
    this.mergeSimilarRoles(cleaned);

    const integrity = await this.calculateSemanticIntegrity(frame, cleaned);
    return { frame: cleaned, integrity };
  }

  private async applySemanticAnalysis(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): Promise<{ frame: CortexFrame; integrity: number }> {
    // Add semantic analysis metadata
    const analysis = await this.performSemanticAnalysis(frame);

    const analyzed = {
      ...frame,
      semanticAnalysis: analysis,
    };

    return { frame: analyzed, integrity: 1.0 };
  }

  private async applyStructureAnalysis(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): Promise<{ frame: CortexFrame; integrity: number }> {
    // Add structure analysis metadata
    const analysis = this.performStructureAnalysis(frame);

    const analyzed = {
      ...frame,
      structureAnalysis: analysis,
    };

    return { frame: analyzed, integrity: 1.0 };
  }

  private removeDuplicateValues(frame: CortexFrame): void {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const [key, value] of Object.entries(frame)) {
      if (key === 'frameType') continue;

      const valueStr = JSON.stringify(value);
      if (seen.has(valueStr)) {
        duplicates.push(key);
      } else {
        seen.add(valueStr);
      }
    }

    // Remove duplicate roles (keep first occurrence)
    for (const dup of duplicates) {
      delete (frame as any)[dup];
    }
  }

  private mergeSimilarRoles(frame: CortexFrame): void {
    // Merge roles with similar meanings
    const roleMappings: Record<string, string[]> = {
      agent: ['actor', 'subject', 'performer'],
      object: ['target', 'recipient'],
      time: ['timestamp', 'date', 'when'],
      location: ['place', 'where'],
    };

    for (const [canonical, aliases] of Object.entries(roleMappings)) {
      const presentAliases = aliases.filter((alias) => alias in frame);

      if (presentAliases.length > 0 && !(canonical in frame)) {
        // Use the first alias as the canonical role
        (frame as any)[canonical] = (frame as any)[presentAliases[0]];

        // Remove alias roles
        for (const alias of presentAliases) {
          delete (frame as any)[alias];
        }
      }
    }
  }

  private async applySemanticTransformation(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): Promise<{ frame: CortexFrame; integrity: number }> {
    // Apply custom transformation from metadata or options
    const transformation =
      (request.metadata as any)?.customTransformation ||
      (request.options as any)?.customTransformation;

    if (!transformation) {
      return { frame, integrity: 1.0 };
    }

    const prompt = this.buildTransformationPrompt(
      frame,
      transformation,
      request,
    );

    const aiResult = await this.aiRouter.invokeModel({
      model:
        request.metadata?.model || DEFAULT_CORTEX_CONFIG.coreProcessing.model,
      prompt,
      parameters: {
        temperature: 0.1,
        maxTokens: 2000,
      },
    });

    const transformedFrame = this.parseProcessingResponse(aiResult.response);
    const integrity = await this.calculateSemanticIntegrity(
      frame,
      transformedFrame,
    );

    return { frame: transformedFrame, integrity };
  }

  private buildCompressionPrompt(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): string {
    const targetReduction = request.options?.targetReduction || 0.3;
    const preserveSemantics = request.options?.preserveSemantics !== false;
    const enableInference = request.options?.enableInference || false;
    const customInstructions =
      (request.options as any)?.customInstructions || '';

    return `
You are a Cortex Semantic Compressor. Your task is to compress the given Cortex frame while preserving its core semantic meaning.

ORIGINAL FRAME:
${JSON.stringify(frame, null, 2)}

COMPRESSION REQUIREMENTS:
- Target reduction: ${(targetReduction * 100).toFixed(0)}%
- Preserve semantic integrity: ${preserveSemantics ? 'Yes' : 'No'}
- Enable inference: ${enableInference ? 'Yes' : 'No'}
- Maintain core action and intent
- Remove redundant information
- Simplify complex structures where possible
${customInstructions ? `- Additional instructions: ${customInstructions}` : ''}

OUTPUT FORMAT:
Return a compressed Cortex frame as valid JSON that maintains the essential semantic content.

COMPRESSED FRAME:
`;
  }

  private buildEnhancementPrompt(
    frame: CortexFrame,
    request: CortexProcessingRequest,
  ): string {
    const enableInference = request.options?.enableInference !== false;
    const preserveSemantics = request.options?.preserveSemantics !== false;
    const customInstructions =
      (request.options as any)?.customInstructions || '';
    const contextInfo = (request.metadata as any)?.context || '';

    return `
You are a Cortex Semantic Enhancer. Your task is to enhance the given Cortex frame with additional semantic information and inferences.

ORIGINAL FRAME:
${JSON.stringify(frame, null, 2)}

ENHANCEMENT TASK:
- Add inferred semantic relationships: ${enableInference ? 'Yes' : 'No'}
- Include contextual information: ${contextInfo ? `Context: ${contextInfo}` : 'None provided'}
- Enhance with related concepts
- Add semantic metadata
- Preserve original meaning: ${preserveSemantics ? 'Yes' : 'No'}
${customInstructions ? `- Additional instructions: ${customInstructions}` : ''}

OUTPUT FORMAT:
Return an enhanced Cortex frame as valid JSON with additional semantic information.

ENHANCED FRAME:
`;
  }

  private buildTransformationPrompt(
    frame: CortexFrame,
    transformation: string,
    request: CortexProcessingRequest,
  ): string {
    const preserveSemantics = request.options?.preserveSemantics !== false;
    const enableInference = request.options?.enableInference || false;
    const customInstructions =
      (request.options as any)?.customInstructions || '';
    const contextInfo = (request.metadata as any)?.context || '';

    return `
You are a Cortex Semantic Transformer. Apply the following transformation to the Cortex frame.

ORIGINAL FRAME:
${JSON.stringify(frame, null, 2)}

TRANSFORMATION:
${transformation}

ADDITIONAL PARAMETERS:
- Preserve semantic integrity: ${preserveSemantics ? 'Yes' : 'No'}
- Enable inference: ${enableInference ? 'Yes' : 'No'}
- Context information: ${contextInfo || 'None provided'}
${customInstructions ? `- Additional instructions: ${customInstructions}` : ''}

OUTPUT FORMAT:
Return the transformed Cortex frame as valid JSON.

TRANSFORMED FRAME:
`;
  }

  private parseProcessingResponse(response: string): CortexFrame {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in processing response');
      }

      return JSON.parse(jsonMatch[0]) as CortexFrame;
    } catch (error) {
      this.logger.error('Failed to parse processing response', {
        response,
        error,
      });
      // Return original frame as fallback
      return { frameType: 'query', action: 'action_process' };
    }
  }

  private async generateOptimizationsReport(
    original: CortexFrame,
    processed: CortexFrame,
  ): Promise<CortexProcessingResult['optimizations']> {
    const originalTokens = this.estimateTokenCount(original);
    const processedTokens = this.estimateTokenCount(processed);
    const savings = Math.max(0, originalTokens - processedTokens);
    const reduction = originalTokens > 0 ? (savings / originalTokens) * 100 : 0;

    return [
      {
        type: 'semantic_compression',
        description: 'Compressed semantic structure while preserving meaning',
        savings: {
          tokensSaved: savings,
          reductionPercentage: reduction,
        },
        confidence: 0.85,
      },
    ];
  }

  private async calculateSemanticIntegrity(
    original: CortexFrame,
    processed: CortexFrame,
  ): Promise<number> {
    // Use vocabulary service to check semantic similarity
    const similarity = this.vocabulary.calculateSemanticSimilarity(
      JSON.stringify(original),
      JSON.stringify(processed),
    );

    return similarity.score;
  }

  private generateCacheKey(request: CortexProcessingRequest): string {
    return `${request.operation}_${JSON.stringify(request.input)}_${JSON.stringify(request.options)}`;
  }

  private generateSemanticHash(frame: CortexFrame): string {
    const content = JSON.stringify(frame);
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private estimateTokenCount(frame: CortexFrame): number {
    return Math.ceil(JSON.stringify(frame).length / 4);
  }

  private extractReferences(frame: CortexFrame): string[] {
    // Enhanced reference extraction using semantic analysis and pattern recognition
    const references: string[] = [];
    const content = JSON.stringify(frame);

    // Extract different types of references
    const entityReferences = this.extractEntityReferences(frame);
    const conceptReferences = this.extractConceptReferences(content);
    const patternReferences = this.extractPatternReferences(content);
    const structuralReferences = this.extractStructuralReferences(frame);

    // Combine and deduplicate references
    const allReferences = [
      ...entityReferences,
      ...conceptReferences,
      ...patternReferences,
      ...structuralReferences,
    ];

    // Score and rank references
    const scoredReferences = this.scoreReferences(allReferences, frame);

    // Return top references (limit to prevent bloat)
    return scoredReferences
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((ref) => ref.reference);
  }

  /**
   * Extract entity-based references
   */
  private extractEntityReferences(
    frame: CortexFrame,
  ): Array<{ reference: string; type: string }> {
    const references: Array<{ reference: string; type: string }> = [];
    const entities = this.extractEntities(frame);

    entities.forEach((entity) => {
      if (entity.confidence > 0.7) {
        references.push({
          reference: entity.value,
          type: 'entity',
        });
      }
    });

    return references;
  }

  /**
   * Extract concept-based references from content
   */
  private extractConceptReferences(
    content: string,
  ): Array<{ reference: string; type: string }> {
    const references: Array<{ reference: string; type: string }> = [];
    const concepts = this.identifyKeyConcepts(content);

    concepts.forEach((concept) => {
      references.push({
        reference: concept,
        type: 'concept',
      });
    });

    return references;
  }

  /**
   * Extract pattern-based references (repeated phrases, IDs, etc.)
   */
  private extractPatternReferences(
    content: string,
  ): Array<{ reference: string; type: string }> {
    const references: Array<{ reference: string; type: string }> = [];

    // Extract UUID-like patterns
    const uuidPattern =
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
    let match;
    while ((match = uuidPattern.exec(content)) !== null) {
      references.push({
        reference: match[0],
        type: 'id',
      });
    }

    // Extract email-like patterns
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    while ((match = emailPattern.exec(content)) !== null) {
      references.push({
        reference: match[0],
        type: 'contact',
      });
    }

    // Extract URL-like patterns
    const urlPattern = /\bhttps?:\/\/[^\s<>"']+/gi;
    while ((match = urlPattern.exec(content)) !== null) {
      references.push({
        reference: match[0],
        type: 'url',
      });
    }

    // Extract repeated phrases (2-4 words)
    const phraseReferences = this.extractRepeatedPhrases(content);
    phraseReferences.forEach((phrase) => {
      references.push({
        reference: phrase,
        type: 'phrase',
      });
    });

    return references;
  }

  /**
   * Extract structural references from frame keys and metadata
   */
  private extractStructuralReferences(
    frame: CortexFrame,
  ): Array<{ reference: string; type: string }> {
    const references: Array<{ reference: string; type: string }> = [];

    // Extract frame ID if present
    if ('id' in frame && frame.id) {
      references.push({
        reference: String(frame.id),
        type: 'frame_id',
      });
    }

    // Extract role names as structural references
    if (
      'roles' in frame &&
      typeof frame.roles === 'object' &&
      frame.roles !== null
    ) {
      Object.keys(frame.roles).forEach((roleName) => {
        references.push({
          reference: roleName,
          type: 'role',
        });
      });
    }

    // Extract frame type
    if (frame.frameType) {
      references.push({
        reference: frame.frameType,
        type: 'frame_type',
      });
    }

    return references;
  }

  /**
   * Identify key concepts from content using semantic analysis
   */
  private identifyKeyConcepts(content: string): string[] {
    const concepts: string[] = [];
    const tokens = content.toLowerCase().match(/\b\w{4,}\b/g) || [];

    // Define concept categories with their indicators
    const conceptCategories = {
      technical: [
        'algorithm',
        'system',
        'process',
        'method',
        'function',
        'component',
        'module',
        'interface',
      ],
      business: [
        'strategy',
        'goal',
        'objective',
        'requirement',
        'solution',
        'approach',
        'framework',
      ],
      domain: [
        'model',
        'structure',
        'pattern',
        'design',
        'architecture',
        'implementation',
        'deployment',
      ],
    };

    // Score tokens against concept categories
    const conceptScores: Record<string, number> = {};

    tokens.forEach((token) => {
      let score = 0;

      for (const [category, indicators] of Object.entries(conceptCategories)) {
        if (indicators.includes(token)) {
          score += 2; // Direct match
        } else {
          // Check for partial matches or related terms
          const relatedTerms = this.getRelatedTerms(category);
          if (relatedTerms.includes(token)) {
            score += 1;
          }
        }
      }

      if (score > 0) {
        conceptScores[token] = (conceptScores[token] || 0) + score;
      }
    });

    // Return top-scoring concepts
    return Object.entries(conceptScores)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([concept]) => concept);
  }

  /**
   * Get related terms for a concept category
   */
  private getRelatedTerms(category: string): string[] {
    const relatedTermsMap: Record<string, string[]> = {
      technical: [
        'code',
        'programming',
        'development',
        'software',
        'hardware',
        'database',
        'network',
      ],
      business: [
        'management',
        'planning',
        'execution',
        'performance',
        'efficiency',
        'optimization',
      ],
      domain: [
        'logic',
        'flow',
        'control',
        'state',
        'transition',
        'event',
        'action',
      ],
    };

    return relatedTermsMap[category] || [];
  }

  /**
   * Extract repeated phrases from content
   */
  private extractRepeatedPhrases(content: string): string[] {
    const phrases: string[] = [];
    const words = content.toLowerCase().match(/\b\w+\b/g) || [];
    const phraseCounts: Record<string, number> = {};

    // Extract 2-3 word phrases
    for (let i = 0; i < words.length - 1; i++) {
      // 2-word phrases
      if (i < words.length - 1) {
        const phrase2 = `${words[i]} ${words[i + 1]}`;
        phraseCounts[phrase2] = (phraseCounts[phrase2] || 0) + 1;
      }

      // 3-word phrases
      if (i < words.length - 2) {
        const phrase3 = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        phraseCounts[phrase3] = (phraseCounts[phrase3] || 0) + 1;
      }
    }

    // Return phrases that appear more than once
    return Object.entries(phraseCounts)
      .filter(([, count]) => count > 1)
      .map(([phrase]) => phrase);
  }

  /**
   * Score references based on relevance and context
   */
  private scoreReferences(
    references: Array<{ reference: string; type: string }>,
    frame: CortexFrame,
  ): Array<{ reference: string; score: number }> {
    return references.map((ref) => {
      let score = 1.0; // Base score

      // Type-based scoring
      switch (ref.type) {
        case 'entity':
          score *= 1.5;
          break;
        case 'id':
          score *= 1.3;
          break;
        case 'url':
          score *= 1.2;
          break;
        case 'concept':
          score *= 1.4;
          break;
        case 'frame_id':
          score *= 1.6;
          break;
        case 'role':
          score *= 1.1;
          break;
      }

      // Length-based scoring (prefer meaningful references)
      if (ref.reference.length < 3) score *= 0.5;
      else if (ref.reference.length > 50) score *= 0.8;

      // Context relevance scoring
      const contextRelevance = this.calculateContextRelevance(
        ref.reference,
        frame,
      );
      score *= 1 + contextRelevance;

      return {
        reference: ref.reference,
        score,
      };
    });
  }

  /**
   * Calculate how relevant a reference is to the frame context
   */
  private calculateContextRelevance(
    reference: string,
    frame: CortexFrame,
  ): number {
    const frameContent = JSON.stringify(frame).toLowerCase();
    const referenceCount = (
      frameContent.match(new RegExp(reference.toLowerCase(), 'g')) || []
    ).length;

    // More occurrences = higher relevance
    if (referenceCount > 5) return 0.5;
    if (referenceCount > 2) return 0.3;
    if (referenceCount > 1) return 0.1;

    return 0;
  }

  private removeRedundancy(frame: CortexFrame): CortexFrame {
    // Remove redundant and unnecessary information
    const cleaned = { ...frame };

    // Remove roles with default/empty values
    for (const [key, value] of Object.entries(cleaned)) {
      if (key === 'frameType') continue;

      if (
        value === '' ||
        value === null ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === 'object' && Object.keys(value).length === 0)
      ) {
        delete (cleaned as Record<string, unknown>)[key];
      }
    }

    // Remove redundant temporal information
    this.removeRedundantTemporalInfo(cleaned);

    return cleaned;
  }

  private removeRedundantTemporalInfo(frame: CortexFrame): void {
    // If both 'time' and 'timestamp' exist and are the same, keep only one
    const timeValue = (frame as any).time;
    const timestampValue = (frame as any).timestamp;

    if (timeValue && timestampValue && timeValue === timestampValue) {
      delete (frame as any).timestamp; // Keep 'time' as primary
    }
  }

  private async performSemanticAnalysis(frame: CortexFrame): Promise<any> {
    const analysis = {
      complexity: this.calculateSemanticComplexity(frame),
      entities: this.extractEntities(frame),
      relationships: this.identifyEntityRelationships(frame),
      sentiment: this.analyzeSentiment(frame),
      topics: this.extractTopics(frame),
      intent: this.classifyIntent(frame),
    };

    return analysis;
  }

  private calculateSemanticComplexity(frame: CortexFrame): string {
    const roleCount = Object.keys(frame).length - 1;
    const avgValueLength =
      Object.values(frame)
        .filter((v) => typeof v === 'string')
        .reduce((sum, v: string) => sum + v.length, 0) /
      Math.max(
        1,
        Object.values(frame).filter((v) => typeof v === 'string').length,
      );

    if (roleCount > 5 || avgValueLength > 100) return 'high';
    if (roleCount > 2 || avgValueLength > 50) return 'medium';
    return 'low';
  }

  private extractEntities(
    frame: CortexFrame,
  ): Array<{ type: string; value: string; confidence: number }> {
    const entities: Array<{ type: string; value: string; confidence: number }> =
      [];

    for (const [key, value] of Object.entries(frame)) {
      if (typeof value === 'string') {
        // Enhanced entity extraction using patterns and context
        const extractedEntities = this.extractEntitiesFromText(value, key);
        entities.push(...extractedEntities);
      } else if (typeof value === 'object' && value !== null) {
        // Handle nested objects
        const nestedEntities = this.extractEntitiesFromObject(value, key);
        entities.push(...nestedEntities);
      }
    }

    // Remove duplicates and sort by confidence
    const uniqueEntities = this.deduplicateEntities(entities);
    return uniqueEntities.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Extract entities from text using enhanced pattern matching
   */
  private extractEntitiesFromText(
    text: string,
    contextKey: string,
  ): Array<{ type: string; value: string; confidence: number }> {
    const entities: Array<{ type: string; value: string; confidence: number }> =
      [];

    // Person name patterns
    if (this.isPersonContext(contextKey) || this.containsPersonPatterns(text)) {
      const personEntities = this.extractPersonEntities(text);
      entities.push(...personEntities);
    }

    // Location patterns
    if (
      this.isLocationContext(contextKey) ||
      this.containsLocationPatterns(text)
    ) {
      const locationEntities = this.extractLocationEntities(text);
      entities.push(...locationEntities);
    }

    // Organization patterns
    if (
      this.isOrganizationContext(contextKey) ||
      this.containsOrganizationPatterns(text)
    ) {
      const orgEntities = this.extractOrganizationEntities(text);
      entities.push(...orgEntities);
    }

    // Date/Time patterns
    const dateEntities = this.extractDateTimeEntities(text);
    entities.push(...dateEntities);

    // Number/Quantity patterns
    const numberEntities = this.extractNumberEntities(text);
    entities.push(...numberEntities);

    return entities;
  }

  /**
   * Extract entities from nested objects
   */
  private extractEntitiesFromObject(
    obj: any,
    contextKey: string,
  ): Array<{ type: string; value: string; confidence: number }> {
    const entities: Array<{ type: string; value: string; confidence: number }> =
      [];

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        if (typeof item === 'string') {
          entities.push(
            ...this.extractEntitiesFromText(item, `${contextKey}[${index}]`),
          );
        } else if (typeof item === 'object' && item !== null) {
          entities.push(
            ...this.extractEntitiesFromObject(item, `${contextKey}[${index}]`),
          );
        }
      });
    } else {
      Object.entries(obj).forEach(([key, value]) => {
        const fullKey = `${contextKey}.${key}`;
        if (typeof value === 'string') {
          entities.push(...this.extractEntitiesFromText(value, fullKey));
        } else if (typeof value === 'object' && value !== null) {
          entities.push(...this.extractEntitiesFromObject(value, fullKey));
        }
      });
    }

    return entities;
  }

  /**
   * Context analysis for entity types
   */
  private isPersonContext(key: string): boolean {
    const personKeywords = [
      'name',
      'person',
      'user',
      'author',
      'creator',
      'owner',
      'contact',
    ];
    return personKeywords.some((keyword) =>
      key.toLowerCase().includes(keyword),
    );
  }

  private isLocationContext(key: string): boolean {
    const locationKeywords = [
      'location',
      'place',
      'address',
      'city',
      'country',
      'region',
    ];
    return locationKeywords.some((keyword) =>
      key.toLowerCase().includes(keyword),
    );
  }

  private isOrganizationContext(key: string): boolean {
    const orgKeywords = [
      'organization',
      'company',
      'business',
      'corp',
      'inc',
      'ltd',
      'group',
    ];
    return orgKeywords.some((keyword) => key.toLowerCase().includes(keyword));
  }

  /**
   * Pattern-based entity detection
   */
  private containsPersonPatterns(text: string): boolean {
    // Check for name-like patterns (Title Case, common names)
    const titleCaseWords = text.match(/\b[A-Z][a-z]+\b/g) || [];
    return titleCaseWords.length >= 2;
  }

  private containsLocationPatterns(text: string): boolean {
    // Check for location indicators
    const locationIndicators = [
      'street',
      'avenue',
      'road',
      'city',
      'state',
      'country',
      'zip',
    ];
    return locationIndicators.some((indicator) =>
      text.toLowerCase().includes(indicator),
    );
  }

  private containsOrganizationPatterns(text: string): boolean {
    // Check for organization indicators
    const orgIndicators = [
      'inc',
      'corp',
      'ltd',
      'llc',
      'co',
      'company',
      'corporation',
    ];
    return orgIndicators.some((indicator) =>
      text.toLowerCase().includes(indicator.toLowerCase()),
    );
  }

  /**
   * Specific entity extractors
   */
  private extractPersonEntities(
    text: string,
  ): Array<{ type: string; value: string; confidence: number }> {
    const entities: Array<{ type: string; value: string; confidence: number }> =
      [];

    // Extract potential person names (2-3 word sequences starting with capital letters)
    const words = text.split(/\s+/);
    for (let i = 0; i < words.length - 1; i++) {
      if (/^[A-Z][a-z]+$/.test(words[i])) {
        let name = words[i];
        let confidence = 0.7;

        // Check for multi-word names
        if (i + 1 < words.length && /^[A-Z][a-z]+$/.test(words[i + 1])) {
          name += ' ' + words[i + 1];
          confidence = 0.85;

          // Check for three-word names
          if (i + 2 < words.length && /^[A-Z][a-z]*$/.test(words[i + 2])) {
            name += ' ' + words[i + 2];
            confidence = 0.9;
          }
        }

        entities.push({ type: 'person', value: name, confidence });
      }
    }

    return entities;
  }

  private extractLocationEntities(
    text: string,
  ): Array<{ type: string; value: string; confidence: number }> {
    const entities: Array<{ type: string; value: string; confidence: number }> =
      [];

    // City, State patterns
    const cityStatePattern =
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2}|[A-Z][a-z]+)\b/g;
    let match;
    while ((match = cityStatePattern.exec(text)) !== null) {
      entities.push({ type: 'location', value: match[0], confidence: 0.9 });
    }

    // Country names (simplified list)
    const countries = [
      'United States',
      'United Kingdom',
      'Canada',
      'Australia',
      'Germany',
      'France',
    ];
    countries.forEach((country) => {
      if (text.includes(country)) {
        entities.push({ type: 'location', value: country, confidence: 0.95 });
      }
    });

    return entities;
  }

  private extractOrganizationEntities(
    text: string,
  ): Array<{ type: string; value: string; confidence: number }> {
    const entities: Array<{ type: string; value: string; confidence: number }> =
      [];

    // Company name patterns
    const companyPatterns = [
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(Inc|Ltd|Corp|LLC|Co|Company|Corporation)\b/g,
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(Inc|Ltd|Corp|LLC|Co)\./g,
    ];

    companyPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        entities.push({
          type: 'organization',
          value: match[0],
          confidence: 0.9,
        });
      }
    });

    return entities;
  }

  private extractDateTimeEntities(
    text: string,
  ): Array<{ type: string; value: string; confidence: number }> {
    const entities: Array<{ type: string; value: string; confidence: number }> =
      [];

    // Date patterns
    const datePatterns = [
      /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, // MM/DD/YYYY
      /\b\d{4}-\d{2}-\d{2}\b/g, // YYYY-MM-DD
      /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi,
    ];

    datePatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        entities.push({ type: 'date', value: match[0], confidence: 0.85 });
      }
    });

    return entities;
  }

  private extractNumberEntities(
    text: string,
  ): Array<{ type: string; value: string; confidence: number }> {
    const entities: Array<{ type: string; value: string; confidence: number }> =
      [];

    // Currency patterns
    const currencyPatterns = [
      /\$\d+(?:\.\d{2})?/g, // $123.45
      /\b\d+(?:\.\d{2})?\s*(?:USD|dollars?|euros?|pounds?)\b/gi,
    ];

    currencyPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        entities.push({ type: 'currency', value: match[0], confidence: 0.9 });
      }
    });

    // Percentage patterns
    const percentPatterns = [/\b\d+(?:\.\d+)?%\b/g];
    percentPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        entities.push({ type: 'percentage', value: match[0], confidence: 0.8 });
      }
    });

    return entities;
  }

  /**
   * Remove duplicate entities and merge similar ones
   */
  private deduplicateEntities(
    entities: Array<{ type: string; value: string; confidence: number }>,
  ): Array<{ type: string; value: string; confidence: number }> {
    const seen = new Map<
      string,
      { type: string; value: string; confidence: number }
    >();

    entities.forEach((entity) => {
      const key = `${entity.type}:${entity.value.toLowerCase()}`;
      const existing = seen.get(key);

      if (!existing || entity.confidence > existing.confidence) {
        seen.set(key, entity);
      }
    });

    return Array.from(seen.values());
  }

  private identifyEntityRelationships(
    frame: CortexFrame,
  ): Array<{ type: string; entities: string[]; strength: number }> {
    const relationships: Array<{
      type: string;
      entities: string[];
      strength: number;
    }> = [];

    // Simple relationship extraction based on frame structure
    const entities = this.extractEntities(frame).map((e) => e.value);

    if (entities.length >= 2) {
      relationships.push({
        type: 'related',
        entities,
        strength: 0.6,
      });
    }

    return relationships;
  }

  private analyzeSentiment(frame: CortexFrame): string {
    // Simple sentiment analysis based on keywords
    const text = Object.values(frame)
      .filter((v) => typeof v === 'string')
      .join(' ')
      .toLowerCase();

    const positiveWords = [
      'good',
      'great',
      'excellent',
      'amazing',
      'wonderful',
      'fantastic',
    ];
    const negativeWords = [
      'bad',
      'terrible',
      'awful',
      'horrible',
      'worst',
      'poor',
    ];

    const positiveCount = positiveWords.filter((word) =>
      text.includes(word),
    ).length;
    const negativeCount = negativeWords.filter((word) =>
      text.includes(word),
    ).length;

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  private extractTopics(frame: CortexFrame): string[] {
    // Enhanced topic extraction using TF-IDF-like scoring and semantic analysis
    const topics: string[] = [];
    const text = this.extractTextFromFrame(frame);
    const tokens = this.tokenizeForTopics(text);
    const termFrequencies = this.calculateTermFrequencies(tokens);
    const topicScores = this.scoreTopics(termFrequencies, tokens);

    // Sort topics by score and return top topics
    const sortedTopics = Object.entries(topicScores)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3) // Return top 3 topics
      .map(([topic]) => topic);

    return sortedTopics;
  }

  /**
   * Extract all text content from a frame
   */
  private extractTextFromFrame(frame: CortexFrame): string {
    const textParts: string[] = [];

    const extractText = (obj: any): void => {
      if (typeof obj === 'string') {
        textParts.push(obj);
      } else if (Array.isArray(obj)) {
        obj.forEach((item) => extractText(item));
      } else if (obj && typeof obj === 'object') {
        Object.values(obj).forEach((value) => extractText(value));
      }
    };

    extractText(frame);
    return textParts.join(' ').toLowerCase();
  }

  /**
   * Tokenize text for topic analysis
   */
  private tokenizeForTopics(text: string): string[] {
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !this.isStopWordForTopics(token))
      .map((token) => this.stemToken(token));
  }

  /**
   * Check if token is a stop word for topic analysis
   */
  private isStopWordForTopics(token: string): boolean {
    const stopWords = new Set([
      'the',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'an',
      'a',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'can',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
      'me',
      'him',
      'her',
      'us',
      'them',
      'what',
      'how',
      'when',
      'where',
      'why',
      'who',
    ]);
    return stopWords.has(token);
  }

  /**
   * Simple stemming for topic tokens
   */
  private stemToken(token: string): string {
    // Basic stemming rules
    const stems: Record<string, string> = {
      ing: '',
      ed: '',
      er: '',
      est: '',
      ly: '',
      ied: 'y',
      ies: 'y',
    };

    let stemmed = token;
    for (const [suffix, replacement] of Object.entries(stems)) {
      if (stemmed.endsWith(suffix) && stemmed.length > suffix.length + 2) {
        stemmed = stemmed.slice(0, -suffix.length) + replacement;
        break;
      }
    }

    return stemmed;
  }

  /**
   * Calculate term frequencies
   */
  private calculateTermFrequencies(tokens: string[]): Map<string, number> {
    const frequencies = new Map<string, number>();
    tokens.forEach((token) => {
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    });
    return frequencies;
  }

  /**
   * Score topics based on term frequencies and semantic relevance
   */
  private scoreTopics(
    termFrequencies: Map<string, number>,
    tokens: string[],
  ): Record<string, number> {
    const topicDefinitions = {
      technology: {
        keywords: [
          'computer',
          'software',
          'hardware',
          'program',
          'code',
          'algorithm',
          'system',
          'network',
          'data',
          'information',
          'digital',
          'application',
          'web',
          'mobile',
          'ai',
          'machine',
          'learning',
          'automation',
        ],
        weight: 1.0,
        related: ['business', 'science'],
      },
      business: {
        keywords: [
          'company',
          'market',
          'sale',
          'revenue',
          'profit',
          'customer',
          'client',
          'business',
          'enterprise',
          'commerce',
          'trade',
          'finance',
          'money',
          'cost',
          'price',
          'budget',
          'investment',
        ],
        weight: 1.0,
        related: ['technology', 'health'],
      },
      science: {
        keywords: [
          'research',
          'study',
          'experiment',
          'analysis',
          'data',
          'method',
          'theory',
          'hypothesis',
          'result',
          'conclusion',
          'evidence',
          'observation',
          'measurement',
          'test',
          'investigation',
        ],
        weight: 0.9,
        related: ['technology', 'health'],
      },
      health: {
        keywords: [
          'medical',
          'patient',
          'treatment',
          'disease',
          'health',
          'doctor',
          'hospital',
          'medicine',
          'drug',
          'therapy',
          'diagnosis',
          'symptom',
          'care',
          'wellness',
          'clinical',
        ],
        weight: 0.8,
        related: ['science', 'business'],
      },
      education: {
        keywords: [
          'learn',
          'teach',
          'school',
          'university',
          'student',
          'course',
          'class',
          'lesson',
          'knowledge',
          'skill',
          'training',
          'education',
          'academic',
          'study',
          'curriculum',
        ],
        weight: 0.7,
        related: ['technology', 'science'],
      },
      entertainment: {
        keywords: [
          'game',
          'movie',
          'music',
          'video',
          'film',
          'show',
          'play',
          'art',
          'fun',
          'enjoy',
          'leisure',
          'hobby',
          'sport',
          'recreation',
        ],
        weight: 0.6,
        related: ['technology', 'business'],
      },
    };

    const topicScores: Record<string, number> = {};

    // Calculate base scores from keyword matches
    for (const [topic, definition] of Object.entries(topicDefinitions)) {
      let score = 0;
      let matchCount = 0;

      for (const keyword of definition.keywords) {
        const frequency = termFrequencies.get(keyword) || 0;
        if (frequency > 0) {
          score += frequency * definition.weight;
          matchCount++;
        }
      }

      // Boost score based on match density
      if (matchCount > 0) {
        const densityBonus = Math.min(
          matchCount / definition.keywords.length,
          0.5,
        );
        score += densityBonus * 10;
      }

      // Boost related topics slightly
      for (const relatedTopic of definition.related) {
        if (topicScores[relatedTopic] && topicScores[relatedTopic] > 5) {
          score += topicScores[relatedTopic] * 0.1;
        }
      }

      if (score > 0) {
        topicScores[topic] = score;
      }
    }

    // Apply TF-IDF-like normalization
    const maxScore = Math.max(...Object.values(topicScores));
    if (maxScore > 0) {
      Object.keys(topicScores).forEach((topic) => {
        topicScores[topic] = (topicScores[topic] / maxScore) * 100;
      });
    }

    return topicScores;
  }

  private classifyIntent(frame: CortexFrame): string {
    // Classify the primary intent of the frame
    const frameType = frame.frameType;

    switch (frameType) {
      case 'query':
        return 'information_request';
      case 'event':
        return 'action_description';
      case 'state':
        return 'status_report';
      case 'entity':
        return 'entity_description';
      case 'list':
        return 'enumeration';
      case 'error':
        return 'error_reporting';
      default:
        return 'general_communication';
    }
  }

  private performStructureAnalysis(frame: CortexFrame): any {
    const roleCount = Object.keys(frame).length - 1;
    const structure = {
      depth: this.calculateStructureDepth(frame),
      branchingFactor: roleCount,
      completeness: this.calculateCompleteness(frame),
      roleDistribution: this.analyzeRoleDistribution(frame),
      nestingLevel: this.calculateNestingLevel(frame),
    };

    return structure;
  }

  private calculateStructureDepth(frame: CortexFrame): number {
    let maxDepth = 1;

    const calculateDepth = (obj: any, currentDepth: number): number => {
      if (!obj || typeof obj !== 'object') return currentDepth;

      let localMax = currentDepth;

      if (Array.isArray(obj)) {
        for (const item of obj) {
          localMax = Math.max(localMax, calculateDepth(item, currentDepth + 1));
        }
      } else {
        for (const value of Object.values(obj)) {
          localMax = Math.max(
            localMax,
            calculateDepth(value, currentDepth + 1),
          );
        }
      }

      return localMax;
    };

    for (const value of Object.values(frame)) {
      maxDepth = Math.max(maxDepth, calculateDepth(value, 1));
    }

    return maxDepth;
  }

  private calculateCompleteness(frame: CortexFrame): number {
    // Calculate how complete the frame is based on expected roles
    const expectedRoles = this.getExpectedRoles(frame.frameType);
    const presentRoles = Object.keys(frame).filter(
      (key) => key !== 'frameType',
    );
    const presentExpected = presentRoles.filter((role) =>
      expectedRoles.includes(role),
    );

    return presentExpected.length / expectedRoles.length;
  }

  private analyzeRoleDistribution(frame: CortexFrame): Record<string, number> {
    const distribution: Record<string, number> = {};

    for (const [key, value] of Object.entries(frame)) {
      if (key === 'frameType') continue;

      const type = Array.isArray(value)
        ? 'array'
        : typeof value === 'object'
          ? 'object'
          : typeof value;
      distribution[type] = (distribution[type] || 0) + 1;
    }

    return distribution;
  }

  private calculateNestingLevel(frame: CortexFrame): number {
    let maxNesting = 0;

    const calculateNesting = (obj: any, currentLevel: number): number => {
      if (!obj || typeof obj !== 'object') return currentLevel;

      let localMax = currentLevel;

      if (Array.isArray(obj)) {
        for (const item of obj) {
          localMax = Math.max(localMax, calculateNesting(item, currentLevel));
        }
      } else {
        for (const value of Object.values(obj)) {
          localMax = Math.max(
            localMax,
            calculateNesting(value, currentLevel + 1),
          );
        }
      }

      return localMax;
    };

    for (const value of Object.values(frame)) {
      maxNesting = Math.max(maxNesting, calculateNesting(value, 0));
    }

    return maxNesting;
  }

  private getExpectedRoles(frameType: string): string[] {
    // Define expected roles for different frame types
    const expectedRolesMap: Record<string, string[]> = {
      query: ['action', 'agent', 'object', 'target'],
      answer: ['content', 'confidence', 'source'],
      event: ['action', 'agent', 'object', 'time'],
      state: ['entity', 'property', 'value'],
      entity: ['type', 'name', 'properties'],
      list: ['items', 'type'],
      error: ['type', 'message', 'code'],
    };

    return expectedRolesMap[frameType] || [];
  }

  private calculateFrameComplexity(frame: CortexFrame): number {
    let complexity = 1;

    // Base complexity from number of roles
    complexity += Object.keys(frame).length * 0.5;

    // Additional complexity from nested structures
    for (const value of Object.values(frame)) {
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          complexity += value.length * 0.3;
          // Check nested objects in arrays
          for (const item of value) {
            if (typeof item === 'object' && item !== null) {
              complexity += 1;
            }
          }
        } else {
          complexity += 2; // Nested object
          complexity += Object.keys(value).length * 0.2;
        }
      }
    }

    return complexity;
  }

  private applyCompressionOptimization(
    frame: CortexFrame,
    targetReduction: number,
    preserveSemantics: boolean,
  ): CortexFrame {
    let optimized = this.optimizeFrameStructure(frame);

    // Apply aggressive compression techniques
    if (targetReduction > 0.3) {
      optimized = this.applyAggressiveCompression(optimized);
    }

    // Always reorder and flatten for compression
    this.reorderRolesForEfficiency(optimized);
    this.flattenNestedStructures(optimized);

    if (preserveSemantics) {
      optimized = this.applySemanticPreservation(optimized, frame);
    }

    return optimized;
  }

  private applyBalancedOptimization(
    frame: CortexFrame,
    enableInference: boolean,
    preserveSemantics: boolean,
  ): CortexFrame {
    let optimized = this.optimizeFrameStructure(frame);
    this.reorderRolesForEfficiency(optimized);
    this.flattenNestedStructures(optimized);

    if (enableInference) {
      optimized = this.applyInferenceBasedOptimization(optimized);
    }

    if (preserveSemantics) {
      optimized = this.applySemanticPreservation(optimized, frame);
    }

    return optimized;
  }

  private applyAnalysisOptimization(frame: CortexFrame): CortexFrame {
    // Minimal optimization to preserve analysis capabilities
    const optimized = this.optimizeFrameStructure(frame);
    // Only remove obviously redundant information, keep structure intact
    this.removeObviousRedundancies(optimized);
    return optimized;
  }

  private applyTransformOptimization(
    frame: CortexFrame,
    preserveSemantics: boolean,
  ): CortexFrame {
    const optimized = this.optimizeFrameStructure(frame);

    if (preserveSemantics) {
      // Keep structure more intact for transformations
      return optimized;
    } else {
      // Allow more aggressive optimization for non-semantic-preserving transforms
      this.reorderRolesForEfficiency(optimized);
      this.flattenNestedStructures(optimized);
      return optimized;
    }
  }

  private applyAnswerOptimization(
    frame: CortexFrame,
    enableInference: boolean,
  ): CortexFrame {
    let optimized = this.optimizeFrameStructure(frame);
    this.reorderRolesForEfficiency(optimized);

    if (enableInference) {
      // Add answer-specific optimizations
      optimized = this.optimizeForAnswerGeneration(optimized);
    }

    return optimized;
  }

  private applyComplexityReduction(
    frame: CortexFrame,
    maxComplexity: number,
  ): CortexFrame {
    const optimized = { ...frame };
    let currentComplexity = this.calculateFrameComplexity(optimized);

    while (
      currentComplexity > maxComplexity &&
      Object.keys(optimized).length > 2
    ) {
      // Remove least important roles first
      const roles = Object.keys(optimized).filter((key) => key !== 'frameType');
      const roleToRemove = this.findLeastImportantRole(optimized, roles);

      if (roleToRemove) {
        delete (optimized as any)[roleToRemove];
        currentComplexity = this.calculateFrameComplexity(optimized);
      } else {
        break; // Can't remove more roles
      }
    }

    return optimized;
  }

  private applySemanticPreservation(
    optimized: CortexFrame,
    original: CortexFrame,
  ): CortexFrame {
    // Ensure critical semantic elements are preserved
    const preserved = { ...optimized };

    // Always preserve frame type
    preserved.frameType = original.frameType;

    // Preserve required roles for the frame type
    const requiredRoles = this.getRequiredRoles(original.frameType);
    for (const role of requiredRoles) {
      if ((original as any)[role] && !(preserved as any)[role]) {
        (preserved as any)[role] = (original as any)[role];
      }
    }

    return preserved;
  }

  /**
   * Applies user-specific optimizations to the frame based on metadata, such as user preferences or constraints.
   * Currently, applies the following (extensible for more):
   * - If metadata.maxLength is set, trims string roles longer than this length.
   * - If metadata.excludeRoles is a string[]: removes these keys from the frame.
   * - If metadata.forceIncludeRoles is string[]: re-inserts these roles from original if missing.
   *
   * @param frame The original CortexFrame
   * @param metadata Object holding user-specific optimization preferences
   */
  private applyUserSpecificOptimizations(
    frame: CortexFrame,
    metadata: any,
  ): CortexFrame {
    const optimized = { ...frame };

    // 1. Exclude specified roles from the frame (user requests "don't send X, Y")
    if (metadata && Array.isArray(metadata.excludeRoles)) {
      for (const key of metadata.excludeRoles) {
        // Only remove if role is present
        if (key in optimized) {
          delete (optimized as any)[key];
        }
      }
    }

    // 2. Enforce maxLength on all string roles, if specified
    if (
      metadata &&
      typeof metadata.maxLength === 'number' &&
      metadata.maxLength > 0
    ) {
      for (const key of Object.keys(optimized)) {
        const value = (optimized as any)[key];
        if (typeof value === 'string' && value.length > metadata.maxLength) {
          (optimized as any)[key] = value.slice(0, metadata.maxLength);
        }
      }
    }

    // 3. Force-include certain roles (from original 'frame') if missing (for user-required semantics)
    if (metadata && Array.isArray(metadata.forceIncludeRoles)) {
      for (const key of metadata.forceIncludeRoles) {
        if ((frame as any)[key] && !(optimized as any)[key]) {
          (optimized as any)[key] = (frame as any)[key];
        }
      }
    }

    return optimized;
  }

  private applyAdvancedOptimizations(
    optimized: CortexFrame,
    original: CortexFrame,
  ): CortexFrame {
    // Apply advanced inference-based optimizations
    let advanced = { ...optimized };

    // Implement advanced optimization techniques
    advanced = this.applyPatternBasedOptimization(advanced);
    advanced = this.applyContextAwareOptimization(advanced, original);

    return advanced;
  }

  private applyAggressiveCompression(frame: CortexFrame): CortexFrame {
    const compressed = { ...frame };

    // Remove all optional metadata and auxiliary information
    for (const [key, value] of Object.entries(compressed)) {
      if (key === 'frameType') continue;

      // Remove complex nested structures
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        const nestedKeys = Object.keys(value);
        if (nestedKeys.length > 1) {
          // Keep only the most important nested property
          const mostImportant = this.findMostImportantNestedKey(
            value,
            nestedKeys,
          );
          (compressed as any)[key] = value[mostImportant];
        }
      }
    }

    return compressed;
  }

  private applyInferenceBasedOptimization(frame: CortexFrame): CortexFrame {
    // Apply optimizations based on inferred relationships and patterns
    const optimized = { ...frame };

    // Implement inference-based optimizations
    this.inferAndAddMissingRelationships(optimized);
    this.optimizeBasedOnUsagePatterns(optimized);

    return optimized;
  }

  private removeObviousRedundancies(frame: CortexFrame): void {
    // Remove only obviously redundant information
    const roles = Object.keys(frame).filter((key) => key !== 'frameType');

    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        const role1 = roles[i];
        const role2 = roles[j];
        const value1 = (frame as any)[role1];
        const value2 = (frame as any)[role2];

        // Remove if they're identical strings
        if (
          typeof value1 === 'string' &&
          typeof value2 === 'string' &&
          value1 === value2
        ) {
          delete (frame as any)[role2]; // Keep first occurrence
          roles.splice(j, 1);
          j--; // Adjust index
        }
      }
    }
  }

  private optimizeForAnswerGeneration(frame: CortexFrame): CortexFrame {
    const optimized = { ...frame };

    // Add answer-specific optimizations
    this.prioritizeAnswerRelevantRoles(optimized);
    this.addAnswerConfidenceIndicators(optimized);

    return optimized;
  }

  private findLeastImportantRole(
    frame: CortexFrame,
    roles: string[],
  ): string | null {
    // Find the role that can be safely removed with least impact
    const importanceScores = roles.map((role) => ({
      role,
      score: this.calculateRoleImportance(frame, role),
    }));

    importanceScores.sort((a, b) => a.score - b.score);
    return importanceScores[0]?.role || null;
  }

  private calculateRoleImportance(frame: CortexFrame, role: string): number {
    let importance = 1;

    // Required roles are very important
    const requiredRoles = this.getRequiredRoles(frame.frameType);
    if (requiredRoles.includes(role)) {
      importance += 10;
    }

    // Roles with unique information are important
    const value = (frame as any)[role];
    if (typeof value === 'object' && value !== null) {
      importance += 2;
    }

    // Roles with longer content are more important
    if (typeof value === 'string' && value.length > 10) {
      importance += 1;
    }

    return importance;
  }

  private findMostImportantNestedKey(obj: any, keys: string[]): string {
    // Find the most important key in a nested object
    let bestKey = keys[0];
    let bestScore = 0;

    for (const key of keys) {
      const value = obj[key];
      let score = 0;

      if (typeof value === 'string' && value.length > 0) score += 2;
      if (typeof value === 'number') score += 1;
      if (Array.isArray(value) && value.length > 0) score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }

    return bestKey;
  }

  private applyPatternBasedOptimization(frame: CortexFrame): CortexFrame {
    const optimized = { ...frame };

    // Apply pattern-based optimizations
    this.consolidateSimilarPatterns(optimized);
    this.removeRedundantPatterns(optimized);

    return optimized;
  }

  private applyContextAwareOptimization(
    optimized: CortexFrame,
    original: CortexFrame,
  ): CortexFrame {
    // Apply context-aware optimizations
    const contextOptimized = { ...optimized };

    // Use original context to inform optimizations
    this.preserveContextualRelationships(contextOptimized, original);

    return contextOptimized;
  }

  private inferAndAddMissingRelationships(frame: CortexFrame): void {
    // Infer and add missing relationships based on frame content
    const roles = Object.keys(frame).filter((key) => key !== 'frameType');

    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        const role1 = roles[i];
        const role2 = roles[j];

        if (this.shouldHaveRelationship(frame, role1, role2)) {
          this.addInferredRelationship(frame, role1, role2);
        }
      }
    }
  }

  private optimizeBasedOnUsagePatterns(frame: CortexFrame): void {
    // Optimize based on common usage patterns
    this.applyCommonOptimizationPatterns(frame);
  }

  private prioritizeAnswerRelevantRoles(frame: CortexFrame): void {
    // Prioritize roles that are relevant for answer generation
    const answerRelevantRoles = ['content', 'confidence', 'source', 'result'];

    // Move relevant roles to the beginning
    const reordered: any = { frameType: frame.frameType };
    const otherRoles: any = {};

    for (const [key, value] of Object.entries(frame)) {
      if (key === 'frameType') continue;

      if (answerRelevantRoles.includes(key)) {
        reordered[key] = value;
      } else {
        otherRoles[key] = value;
      }
    }

    // Add other roles after relevant ones
    Object.assign(reordered, otherRoles);

    // Copy back to frame
    Object.keys(frame).forEach((key) => delete (frame as any)[key]);
    Object.assign(frame, reordered);
  }

  private addAnswerConfidenceIndicators(frame: CortexFrame): void {
    // Add confidence indicators for answer generation
    if (!(frame as any).confidence && (frame as any).content) {
      (frame as any).confidence = this.calculateAnswerConfidence(frame);
    }
  }

  private consolidateSimilarPatterns(frame: CortexFrame): void {
    // Consolidate similar patterns in the frame
    const patterns = new Map<string, any[]>();

    for (const [key, value] of Object.entries(frame)) {
      if (key === 'frameType') continue;

      const patternKey = this.getPatternKey(value);
      if (!patterns.has(patternKey)) {
        patterns.set(patternKey, []);
      }
      patterns.get(patternKey)!.push(key);
    }

    // Consolidate patterns with multiple occurrences
    for (const [pattern, keys] of patterns) {
      if (keys.length > 1) {
        this.consolidatePattern(frame, keys);
      }
    }
  }

  private removeRedundantPatterns(frame: CortexFrame): void {
    // Remove redundant patterns
    const seenPatterns = new Set<string>();

    for (const [key, value] of Object.entries(frame)) {
      if (key === 'frameType') continue;

      const patternKey = this.getPatternKey(value);
      if (seenPatterns.has(patternKey)) {
        delete (frame as any)[key];
      } else {
        seenPatterns.add(patternKey);
      }
    }
  }

  private preserveContextualRelationships(
    optimized: CortexFrame,
    original: CortexFrame,
  ): void {
    // Preserve important contextual relationships from original
    const importantRelationships =
      this.identifyImportantRelationships(original);

    for (const rel of importantRelationships) {
      if (!(optimized as any)[rel.from] || !(optimized as any)[rel.to]) {
        // Restore missing relationships if possible
        if ((original as any)[rel.from]) {
          (optimized as any)[rel.from] = (original as any)[rel.from];
        }
        if ((original as any)[rel.to]) {
          (optimized as any)[rel.to] = (original as any)[rel.to];
        }
      }
    }
  }

  private shouldHaveRelationship(
    frame: CortexFrame,
    role1: string,
    role2: string,
  ): boolean {
    // Determine if two roles should have a relationship
    const value1 = (frame as any)[role1];
    const value2 = (frame as any)[role2];

    if (typeof value1 === 'string' && typeof value2 === 'string') {
      // Check for substring relationships
      return value2.includes(value1) || value1.includes(value2);
    }

    return false;
  }

  private addInferredRelationship(
    frame: CortexFrame,
    role1: string,
    role2: string,
  ): void {
    // Add an inferred relationship between roles
    const relationshipKey = `${role1}_${role2}_relationship`;
    (frame as any)[relationshipKey] = 'inferred';
  }

  private applyCommonOptimizationPatterns(frame: CortexFrame): void {
    // Apply common optimization patterns
    this.removeEmptyValues(frame);
    this.normalizeValueTypes(frame);
  }

  private calculateAnswerConfidence(frame: CortexFrame): number {
    // Calculate confidence score for answer generation
    let confidence = 0.5;

    if ((frame as any).content) confidence += 0.2;
    if ((frame as any).source) confidence += 0.1;
    if (
      (frame as any).confidence &&
      typeof (frame as any).confidence === 'number'
    ) {
      confidence = Math.max(confidence, (frame as any).confidence);
    }

    return Math.min(confidence, 1.0);
  }

  private getPatternKey(value: any): string {
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return `array_${value.length}`;
    if (typeof value === 'object' && value !== null) {
      return `object_${Object.keys(value).sort().join('_')}`;
    }
    return 'other';
  }

  private consolidatePattern(frame: CortexFrame, keys: string[]): void {
    // Consolidate multiple keys with the same pattern
    if (keys.length < 2) return;

    // Keep the first key, remove others
    for (let i = 1; i < keys.length; i++) {
      delete (frame as any)[keys[i]];
    }
  }

  private identifyImportantRelationships(
    frame: CortexFrame,
  ): Array<{ from: string; to: string }> {
    // Identify relationships that should be preserved
    const relationships: Array<{ from: string; to: string }> = [];
    const roles = Object.keys(frame).filter((key) => key !== 'frameType');

    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        if (this.shouldHaveRelationship(frame, roles[i], roles[j])) {
          relationships.push({ from: roles[i], to: roles[j] });
        }
      }
    }

    return relationships;
  }

  private removeEmptyValues(frame: CortexFrame): void {
    // Remove empty or null values
    for (const [key, value] of Object.entries(frame)) {
      if (key === 'frameType') continue;

      if (
        value == null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === 'object' && Object.keys(value).length === 0)
      ) {
        delete (frame as any)[key];
      }
    }
  }

  private normalizeValueTypes(frame: CortexFrame): void {
    // Normalize value types for consistency
    for (const [key, value] of Object.entries(frame)) {
      if (key === 'frameType') continue;

      if (typeof value === 'string' && value.trim() === '') {
        delete (frame as any)[key]; // Remove empty strings
      }
    }
  }
}
