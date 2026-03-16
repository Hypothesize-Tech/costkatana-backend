import { Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { CortexProcessingResult } from '../interfaces/gateway.interfaces';

/** Shape used for cortex frame in encoding/control flow/hybrid (frameType required) */
interface CortexFrameLike {
  frameType: string;
  [key: string]: unknown;
}

/** Normalized complexity for cortexMetadata */
function toComplexityMeta(a: unknown): {
  level: string;
  score: number;
  factors: string[];
  confidence: number;
} {
  const x = a as {
    overallComplexity?: string;
    confidence?: number;
    factors?: string[];
  };
  return {
    level: x?.overallComplexity ?? 'medium',
    score: Math.round(((x?.confidence ?? 0.5) - 0.6) * 200),
    factors: Array.isArray(x?.factors) ? x.factors : [],
    confidence: typeof x?.confidence === 'number' ? x.confidence : 0.5,
  };
}

/** Normalized routing for cortexMetadata */
function toRoutingMeta(r: unknown): {
  selectedTier: string;
  reasoning: string;
  confidence: number;
  costEstimate: any;
} {
  const x = r as {
    selectedTier?: { name?: string };
    reasoning?: string;
    confidence?: number;
    costEstimate?: any;
  };
  return {
    selectedTier: x?.selectedTier?.name ?? 'standard',
    reasoning: typeof x?.reasoning === 'string' ? x.reasoning : '',
    confidence: typeof x?.confidence === 'number' ? x.confidence : 0,
    costEstimate: x?.costEstimate,
  };
}

/** Normalized cortex model names */
function toCortexModelMeta(m: unknown): {
  encoder: string;
  core: string;
  decoder: string;
} {
  const x = m as {
    cortexEncodingModel?: string;
    cortexCoreModel?: string;
    cortexDecodingModel?: string;
  };
  return {
    encoder:
      typeof x?.cortexEncodingModel === 'string' ? x.cortexEncodingModel : '',
    core: typeof x?.cortexCoreModel === 'string' ? x.cortexCoreModel : '',
    decoder:
      typeof x?.cortexDecodingModel === 'string' ? x.cortexDecodingModel : '',
  };
}

/**
 * Gateway Cortex Service - Handles Cortex processing for gateway requests with model selection flexibility
 * Orchestrates the complete Cortex pipeline including encoding, core processing, decoding, and optimization
 */
@Injectable()
export class GatewayCortexService {
  private readonly logger = new Logger(GatewayCortexService.name);

  /**
   * Process request through Cortex pipeline in gateway context
   */
  async processGatewayRequest(
    request: Request,
    originalBody: any,
  ): Promise<CortexProcessingResult> {
    const context = (request as any).gatewayContext;
    const startTime = Date.now();

    try {
      // Extract prompt from various body structures
      const originalPrompt = this.extractPromptFromBody(originalBody);
      if (!originalPrompt) {
        this.logger.debug('No prompt found in request body, bypassing Cortex', {
          requestId: context.requestId,
          bodyKeys: Object.keys(originalBody),
        });
        return {
          processedBody: originalBody,
          cortexMetadata: {
            processingTime: 0,
            gateway: true,
            error: 'no_prompt_found',
          },
          shouldBypass: true,
        };
      }

      // 🎯 ADAPTIVE MODEL ROUTING - Analyze complexity and select optimal models
      const modelRouter = await this.getModelRouter();
      if (
        !modelRouter ||
        typeof (
          modelRouter as {
            analyzePromptComplexity?: (p: string) => Promise<unknown>;
          }
        ).analyzePromptComplexity !== 'function'
      ) {
        this.logger.warn('Model router not available, bypassing Cortex');
        return {
          processedBody: originalBody,
          cortexMetadata: {
            processingTime: Date.now() - startTime,
            gateway: true,
          },
          shouldBypass: true,
        };
      }
      const complexityAnalysis = await (
        modelRouter as {
          analyzePromptComplexity: (p: string) => Promise<unknown>;
        }
      ).analyzePromptComplexity(originalPrompt);

      // Build routing preferences from context
      const routingPreferences = {
        priority: this.inferPriorityFromContext(context),
        preferredModels: {
          encoder: context.cortexEncodingModel,
          core: context.cortexCoreModel,
          decoder: context.cortexDecodingModel,
        },
      };

      // Get routing decision
      const routingDecision = await (
        modelRouter as {
          makeRoutingDecision: (a: unknown, p: unknown) => Promise<unknown>;
        }
      ).makeRoutingDecision(complexityAnalysis, routingPreferences);

      // Use routing decision for optimal model selection
      const getModelConfig = (
        modelRouter as {
          getModelConfiguration?: (r: unknown) => Promise<unknown>;
        }
      ).getModelConfiguration;
      const finalModels =
        typeof getModelConfig === 'function'
          ? await getModelConfig(routingDecision)
          : {
              cortexEncodingModel: context.cortexEncodingModel,
              cortexCoreModel: context.cortexCoreModel,
              cortexDecodingModel: context.cortexDecodingModel,
            };

      const complexityMeta = toComplexityMeta(complexityAnalysis);
      const routingMeta = toRoutingMeta(routingDecision);
      const finalModelsMeta = toCortexModelMeta(finalModels);

      this.logger.log(
        '🚀 Gateway Cortex processing started with adaptive routing',
        {
          requestId: context.requestId,
          userId: context.userId,
          promptLength: originalPrompt.length,
          complexity: complexityMeta.level,
          complexityScore: complexityMeta.score,
          routingTier: routingMeta.selectedTier,
          selectedModels: finalModelsMeta,
          routing: {
            reasoning: routingMeta.reasoning,
            confidence: routingMeta.confidence,
            estimatedCost: routingMeta.costEstimate?.estimatedCost ?? null,
            estimatedTokens: routingMeta.costEstimate?.tokens ?? null,
          },
          operation: context.cortexOperation,
        },
      );

      // 🎯 Step 0: Check semantic cache first (if enabled)
      if (context.cortexSemanticCache) {
        const cachedResult = (await this.checkSemanticCache(
          originalPrompt,
        )) as {
          optimizedPrompt: string;
          createdAt: Date;
          cortexMetadata: Record<string, unknown>;
        } | null;
        if (cachedResult) {
          const processedBody = this.replacePromptInBody(
            originalBody,
            cachedResult.optimizedPrompt,
          );

          this.logger.log('🎯 Gateway Cortex cache HIT', {
            requestId: context.requestId,
            cacheAge: Math.round(
              (Date.now() -
                (cachedResult.createdAt instanceof Date
                  ? cachedResult.createdAt.getTime()
                  : 0)) /
                60000,
            ),
            processingTime: Date.now() - startTime,
          });

          return {
            processedBody,
            cortexMetadata: {
              ...(cachedResult.cortexMetadata ?? {}),
              processingTime: Date.now() - startTime,
              cacheHit: true,
              gateway: true,
            },
            shouldBypass: false,
          };
        }
      }

      // 🧠 Step 0: Context Management - Handle conversational state and history
      this.logger.debug('🧠 Gateway context management...', {
        requestId: context.requestId,
      });
      let contextState: any = null;
      let contextUpdateResult: any = null;
      let optimizedPrompt = originalPrompt;

      // Check if context management is enabled (default: disabled for backward compatibility)
      const isContextManagementEnabled =
        context.cortexContextManagement === true;

      // Extract context identifiers from headers or request
      const sessionId =
        context.cortexSessionId ||
        (request.headers['x-session-id'] as string) ||
        `session_${context.requestId}`;
      const userId = context.userId || 'anonymous';

      if (isContextManagementEnabled) {
        this.logger.log('🧠 Context management enabled', {
          requestId: context.requestId,
          sessionId,
          userId,
          compressionEnabled: context.cortexContextCompression !== false,
        });

        try {
          const contextManager = await this.getContextManager();
          const cm = contextManager as {
            reconstructContext?: (opts: unknown) => Promise<unknown>;
            extractContext?: (
              a: unknown,
              b: string,
              c: string,
            ) => Promise<unknown>;
            updateContext?: (
              a: string,
              b: string,
              c: unknown,
            ) => Promise<unknown>;
          } | null;

          if (cm && typeof cm.reconstructContext === 'function') {
            // Try to retrieve existing context via reconstruction
            const reconstructResult = (await cm.reconstructContext({
              userId,
              sessionId,
              query: originalPrompt,
              maxContextSize: 500,
              includeHistory: true,
            })) as {
              relevantContext?: unknown;
              contextSummary?: string;
              keyEntities?: unknown[];
            };

            if (reconstructResult.relevantContext) {
              contextState = reconstructResult.relevantContext;
              this.logger.log('📋 Retrieved existing context state', {
                requestId: context.requestId,
                sessionId,
                entitiesCount:
                  (contextState as { entities?: { size: number } })?.entities
                    ?.size ?? 0,
                hasPreferences:
                  ((
                    contextState as
                      | { preferences?: { size: number } }
                      | null
                      | undefined
                  )?.preferences?.size ?? 0) > 0,
              });

              // Use context summary as optimized prompt prefix
              optimizedPrompt = `${reconstructResult.contextSummary ?? ''}\n\n${originalPrompt}`;

              this.logger.log('✅ Context applied to prompt', {
                requestId: context.requestId,
                contextSummaryLength: (reconstructResult.contextSummary ?? '')
                  .length,
                keyEntitiesCount: reconstructResult.keyEntities?.length ?? 0,
              });
            }

            // Extract context from current interaction for storage
            if (typeof cm.extractContext === 'function') {
              contextUpdateResult = await cm.extractContext(
                { frameType: 'query', content: originalPrompt } as any, // Simplified frame
                userId,
                sessionId,
              );

              if (contextUpdateResult.intentions.length > 0) {
                this.logger.log('🔄 Context extracted from current turn', {
                  requestId: context.requestId,
                  sessionId,
                  intentionsExtracted: contextUpdateResult.intentions.length,
                  preferencesExtracted: contextUpdateResult.preferences.length,
                });

                // Update the context store with extracted information
                if (typeof cm.updateContext === 'function') {
                  await cm.updateContext(
                    userId,
                    sessionId,
                    contextUpdateResult,
                  );
                }
              }
            }
          }
        } catch (contextError) {
          this.logger.warn(
            '⚠️ Context management failed, proceeding without context optimization',
            {
              requestId: context.requestId,
              error:
                contextError instanceof Error
                  ? contextError.message
                  : String(contextError),
            },
          );
          // Continue with original prompt if context management fails
          optimizedPrompt = originalPrompt;
        }
      } else {
        this.logger.debug(
          '🧠 Context management disabled, using original prompt',
          {
            requestId: context.requestId,
            sessionId,
          },
        );
        // Context management is disabled, use original prompt
        optimizedPrompt = originalPrompt;
      }

      // 🧠 Step 1: Encode natural language to Cortex
      this.logger.debug('🔄 Gateway Cortex encoding...', {
        requestId: context.requestId,
      });
      const encodingRequest = {
        text: optimizedPrompt, // Use context-optimized prompt
        language: 'en',
      };

      const encoderService = await this.getEncoderService();
      if (
        !encoderService ||
        typeof (encoderService as { encode?: (r: unknown) => Promise<unknown> })
          .encode !== 'function'
      ) {
        this.logger.warn('Encoder service not available, bypassing Cortex');
        return {
          processedBody: originalBody,
          cortexMetadata: {
            processingTime: Date.now() - startTime,
            gateway: true,
          },
          shouldBypass: true,
        };
      }
      const encodingResult = await (
        encoderService as {
          encode: (
            r: unknown,
          ) => Promise<{ cortexFrame: CortexFrameLike; confidence: number }>;
        }
      ).encode(encodingRequest);

      // 🔍 Step 1.5: Schema validation - validate encoded structure before expensive processing
      let schemaValidationResult: any = null;
      if (context.cortexSchemaValidation !== false) {
        try {
          const schemaValidator = await this.getSchemaValidator();
          if (
            schemaValidator &&
            typeof (
              schemaValidator as {
                validateFrame?: (f: unknown, s: boolean) => Promise<unknown>;
              }
            ).validateFrame === 'function'
          ) {
            schemaValidationResult = await (
              schemaValidator as {
                validateFrame: (f: unknown, s: boolean) => Promise<unknown>;
              }
            ).validateFrame(
              encodingResult.cortexFrame,
              context.cortexStrictValidation === true,
            );

            this.logger.log('🔍 Schema validation completed', {
              requestId: context.requestId,
              valid: schemaValidationResult.valid,
              score: schemaValidationResult.score,
              errorCount: schemaValidationResult.errors.length,
              warningCount: schemaValidationResult.warnings.length,
              frameType: encodingResult.cortexFrame.frameType,
            });

            // Handle validation failures based on severity
            const criticalErrors = schemaValidationResult.errors.filter(
              (e: any) => e.severity === 'critical',
            );
            const errors = schemaValidationResult.errors.filter(
              (e: any) => e.severity === 'error',
            );

            if (
              criticalErrors.length > 0 &&
              context.cortexStrictValidation === true
            ) {
              // Fail fast on critical errors in strict mode
              this.logger.error(
                '❌ Critical schema validation errors in strict mode',
                {
                  requestId: context.requestId,
                  criticalErrors: criticalErrors.map((e: any) => e.message),
                },
              );

              return {
                processedBody: originalBody,
                cortexMetadata: {
                  error: `Schema validation failed: ${criticalErrors[0].message}`,
                  schemaValidation: schemaValidationResult,
                  processingTime: Date.now() - startTime,
                  gateway: true,
                },
                shouldBypass: true,
              };
            }

            if (
              schemaValidationResult.score < 50 &&
              context.cortexStrictValidation === true
            ) {
              // Quality score too low in strict mode
              this.logger.warn('⚠️ Schema validation score too low', {
                requestId: context.requestId,
                score: schemaValidationResult.score,
                threshold: 50,
              });

              return {
                processedBody: originalBody,
                cortexMetadata: {
                  error: `Schema quality score too low: ${schemaValidationResult.score}/100`,
                  schemaValidation: schemaValidationResult,
                  processingTime: Date.now() - startTime,
                  gateway: true,
                },
                shouldBypass: true,
              };
            }
          }
        } catch (validationError) {
          this.logger.warn(
            '⚠️ Schema validation failed, continuing without it',
            {
              requestId: context.requestId,
              error:
                validationError instanceof Error
                  ? validationError.message
                  : String(validationError),
            },
          );
          schemaValidationResult = {
            valid: false,
            errors: [
              {
                code: 'VALIDATION_ERROR',
                message: String(validationError),
                path: 'root',
                severity: 'warning',
              },
            ],
            warnings: [],
            score: 0,
          };
        }
      }

      // 🧩 Step 1.7: Fragment cache lookup - Check for cached fragments
      let fragmentCacheResult: any = null;
      const fragmentComposition: any = null;

      if (context.cortexFragmentCache !== false) {
        try {
          const fragmentCacheService = await this.getFragmentCacheService();
          if (
            fragmentCacheService &&
            typeof (
              fragmentCacheService as {
                queryFragmentCache?: (f: unknown) => Promise<unknown>;
              }
            ).queryFragmentCache === 'function'
          ) {
            this.logger.log('🧩 Querying fragment cache', {
              requestId: context.requestId,
              frameType: encodingResult.cortexFrame.frameType,
            });

            fragmentCacheResult = await (
              fragmentCacheService as {
                queryFragmentCache: (f: unknown) => Promise<unknown>;
              }
            ).queryFragmentCache(encodingResult.cortexFrame);

            if (fragmentCacheResult.hit) {
              if (fragmentCacheResult.fragment) {
                // Complete fragment cache hit - return cached result
                this.logger.log(
                  '✅ Complete fragment cache hit, bypassing processing',
                  {
                    requestId: context.requestId,
                    fragmentId: fragmentCacheResult.fragment.id,
                    category: fragmentCacheResult.fragment.metadata.category,
                    reusability:
                      fragmentCacheResult.fragment.metadata.reusability,
                    compressionSavings:
                      fragmentCacheResult.metadata.compressionSavings,
                  },
                );

                const optimizedPrompt = this.formatFragmentResult(
                  fragmentCacheResult.fragment,
                );
                const processedBody = this.replacePromptInBody(
                  originalBody,
                  optimizedPrompt,
                );

                const cortexMetadata = {
                  processingTime: Date.now() - startTime,
                  encodingConfidence: encodingResult.confidence,

                  // 🧩 FRAGMENT CACHE METADATA
                  fragmentCache: {
                    enabled: true,
                    hit: true,
                    hitRate: fragmentCacheResult.metadata.hitRate,
                    fragmentsFound: fragmentCacheResult.metadata.fragmentsFound,
                    totalFragments: fragmentCacheResult.metadata.totalFragments,
                    compressionSavings:
                      fragmentCacheResult.metadata.compressionSavings,
                    cacheTime: fragmentCacheResult.metadata.cacheTime,
                    fragmentId: fragmentCacheResult.fragment.id,
                    category: fragmentCacheResult.fragment.metadata.category,
                    bypassedLLM: true,
                  },

                  complexity: toComplexityMeta(complexityAnalysis),
                  routing: toRoutingMeta(routingDecision),
                  schemaValidation: schemaValidationResult
                    ? {
                        enabled: true,
                        valid: schemaValidationResult.valid,
                        score: schemaValidationResult.score,
                      }
                    : { enabled: false },
                  gateway: true,
                  operation: context.cortexOperation,
                  bypassedLLM: true, // Fragment cache handled everything
                };

                context.cortexMetadata = cortexMetadata;

                return {
                  processedBody,
                  cortexMetadata,
                  shouldBypass: false,
                };
              }
            }
          }
        } catch (fragmentError) {
          this.logger.warn(
            '⚠️ Fragment cache query failed, continuing with standard processing',
            {
              requestId: context.requestId,
              error:
                fragmentError instanceof Error
                  ? fragmentError.message
                  : String(fragmentError),
            },
          );
          fragmentCacheResult = {
            hit: false,
            partialHits: [],
            metadata: {
              hitRate: 0,
              fragmentsFound: 0,
              totalFragments: 0,
              cacheTime: 0,
              compressionSavings: 0,
            },
          };
        }
      }

      // ⚡ Step 1.8: Hybrid execution - Execute deterministic operations
      let hybridExecutionResult: any = null;
      if (context.cortexHybridExecution !== false) {
        try {
          const hybridEngine = (await this.getHybridEngine()) as {
            executeHybrid?: (frame: unknown) => Promise<unknown>;
          } | null;
          if (
            hybridEngine &&
            typeof hybridEngine.executeHybrid === 'function'
          ) {
            this.logger.log('⚡ Analyzing frame for hybrid execution', {
              requestId: context.requestId,
              frameType: encodingResult.cortexFrame.frameType,
            });

            hybridExecutionResult = await hybridEngine.executeHybrid(
              encodingResult.cortexFrame,
            );

            if (
              hybridExecutionResult.deterministic &&
              hybridExecutionResult.success
            ) {
              // Complete deterministic execution - return result directly
              this.logger.log(
                '✅ Deterministic execution completed, bypassing LLM',
                {
                  requestId: context.requestId,
                  executedTools: hybridExecutionResult.executedTools.length,
                  costSaved: hybridExecutionResult.metadata.costSaved,
                  executionTime: hybridExecutionResult.metadata.executionTime,
                },
              );

              const optimizedPrompt = this.formatHybridResult(
                hybridExecutionResult,
              );
              const processedBody = this.replacePromptInBody(
                originalBody,
                optimizedPrompt,
              );

              const cortexMetadata = {
                processingTime: Date.now() - startTime,
                encodingConfidence: encodingResult.confidence,

                // ⚡ HYBRID EXECUTION METADATA
                hybridExecution: {
                  enabled: true,
                  deterministic: true,
                  executedTools: hybridExecutionResult.executedTools,
                  apiCalls: hybridExecutionResult.apiCalls,
                  costSaved: hybridExecutionResult.metadata.costSaved,
                  executionTime: hybridExecutionResult.metadata.executionTime,
                  toolsUsed: hybridExecutionResult.metadata.toolsUsed.length,
                  executionType:
                    (hybridExecutionResult as { executionType?: string })
                      .executionType ?? 'hybrid',
                },

                complexity: toComplexityMeta(complexityAnalysis),
                routing: toRoutingMeta(routingDecision),
                schemaValidation: schemaValidationResult
                  ? {
                      enabled: true,
                      valid: schemaValidationResult.valid,
                      score: schemaValidationResult.score,
                    }
                  : { enabled: false },
                gateway: true,
                operation: context.cortexOperation,
                bypassedLLM: true, // Hybrid execution handled everything
              };

              context.cortexMetadata = cortexMetadata;

              return {
                processedBody,
                cortexMetadata,
                shouldBypass: false,
              };
            }
          }
        } catch (hybridError) {
          this.logger.warn(
            '⚠️ Hybrid execution failed, continuing with standard processing',
            {
              requestId: context.requestId,
              error:
                hybridError instanceof Error
                  ? hybridError.message
                  : String(hybridError),
            },
          );
          hybridExecutionResult = {
            success: false,
            result: encodingResult.cortexFrame,
            executionType: 'llm',
            executedTools: [],
            apiCalls: 0,
            deterministic: false,
            metadata: {
              executionTime: 0,
              costSaved: 0,
              toolsUsed: [],
              errors: [String(hybridError)],
              warnings: [],
            },
          };
        }
      }

      // 🔄 Step 1.9: Control flow detection and processing
      let controlFlowResult: any = null;
      const isControlFlowFrame = this.isControlFlowFrame(
        encodingResult.cortexFrame as unknown,
      );

      if (isControlFlowFrame && context.cortexControlFlowEnabled !== false) {
        try {
          const controlFlowService = (await this.getControlFlowService()) as {
            executeControlFlow?: (frame: unknown) => Promise<unknown>;
          } | null;

          this.logger.log('🔄 Executing control flow logic', {
            requestId: context.requestId,
            frameType: encodingResult.cortexFrame.frameType,
            controlType:
              (encodingResult.cortexFrame as any).controlType || 'unknown',
          });

          if (
            !controlFlowService ||
            typeof controlFlowService.executeControlFlow !== 'function'
          ) {
            this.logger.warn('Control flow service not available, skipping');
          } else {
            controlFlowResult = await controlFlowService.executeControlFlow(
              encodingResult.cortexFrame as any,
            );
          }

          if (controlFlowResult.success) {
            this.logger.log('✅ Control flow execution completed', {
              requestId: context.requestId,
              executedSteps: controlFlowResult.executedSteps.length,
              executionTime: controlFlowResult.metadata.executionTime,
              variables: Object.keys(controlFlowResult.variables).length,
            });

            // If control flow completed successfully, return the result directly
            // without going through expensive LLM processing
            const optimizedPrompt =
              this.formatControlFlowResult(controlFlowResult);
            const processedBody = this.replacePromptInBody(
              originalBody,
              optimizedPrompt,
            );

            const cortexMetadata = {
              processingTime: Date.now() - startTime,
              encodingConfidence: encodingResult.confidence,
              controlFlow: {
                enabled: true,
                success: controlFlowResult.success,
                executedSteps: controlFlowResult.executedSteps.length,
                executionTime: controlFlowResult.metadata.executionTime,
                variablesCreated: Object.keys(controlFlowResult.variables)
                  .length,
                errors: controlFlowResult.metadata.errors.length,
                warnings: controlFlowResult.metadata.warnings.length,
                bypassedLLM: false, // Normal processing through LLM
              },
              complexity: toComplexityMeta(complexityAnalysis),
              routing: toRoutingMeta(routingDecision),
              schemaValidation: schemaValidationResult
                ? {
                    enabled: true,
                    valid: schemaValidationResult.valid,
                    score: schemaValidationResult.score,
                  }
                : { enabled: false },
              gateway: true,
              operation: context.cortexOperation,
              bypassedLLM: true, // Control flow handled everything
            };

            // Store metadata in context for response headers
            context.cortexMetadata = cortexMetadata;

            return {
              processedBody,
              cortexMetadata,
              shouldBypass: false,
            };
          }
        } catch (controlFlowError) {
          this.logger.warn(
            '⚠️ Control flow processing failed, continuing with LLM processing',
            {
              requestId: context.requestId,
              error:
                controlFlowError instanceof Error
                  ? controlFlowError.message
                  : String(controlFlowError),
            },
          );
          controlFlowResult = {
            success: false,
            result: 'Control flow execution failed',
            executedSteps: [],
            variables: {},
            metadata: {
              totalSteps: 0,
              executionTime: 0,
              errors: [
                {
                  code: 'CONTROL_FLOW_ERROR',
                  message: String(controlFlowError),
                  recoverable: true,
                },
              ],
              warnings: [],
            },
          };
        }
      }

      // ⚡ Step 2: Process Cortex with adaptively selected model
      this.logger.debug('🔄 Gateway Cortex core processing...', {
        requestId: context.requestId,
        coreModel: finalModelsMeta.core,
        routingTier: routingMeta.selectedTier,
      });
      const processingRequest = {
        input: encodingResult.cortexFrame,
        operation: 'answer', // NEW ARCHITECTURE: Always answer generation,
        options: {
          preserveSemantics: context.cortexPreserveSemantics !== false,
          targetReduction: this.getTargetReduction(
            ((complexityAnalysis as { overallComplexity?: string })
              .overallComplexity ?? 'medium') as
              | 'simple'
              | 'medium'
              | 'complex'
              | 'expert',
          ),
          enableInference: true,
        },
        metadata: {
          userId: context.userId,
          provider: 'gateway',
          model: finalModelsMeta.core,
        },
      };

      const coreService = (await this.getCoreService()) as {
        process?: (req: unknown) => Promise<unknown>;
      } | null;
      if (!coreService || typeof coreService.process !== 'function') {
        throw new Error('Cortex core service not available');
      }
      const processingResult = await coreService.process(processingRequest);

      // 🗜️ Optional: Binary serialize intermediate Cortex for caching/transmission efficiency
      let binarySerializationMetadata: any = {};
      if (context.cortexBinaryEnabled) {
        try {
          const binarySerializer = (await this.getBinarySerializer()) as {
            serialize?: (output: unknown, opts: unknown) => Promise<unknown>;
            deserialize?: (data: unknown) => Promise<unknown>;
          } | null;
          if (
            binarySerializer &&
            typeof binarySerializer.serialize === 'function' &&
            typeof binarySerializer.deserialize === 'function'
          ) {
            const binaryOptions = {
              compressionLevel: context.cortexBinaryCompression || 'standard',
              includeMetadata: true,
              validateIntegrity: true,
              optimizeForSpeed: false,
            };

            const binaryResult = await binarySerializer.serialize(
              (processingResult as { output: unknown }).output,
              binaryOptions,
            );

            binarySerializationMetadata = {
              enabled: true,
              originalSize: (binaryResult as any).originalSize,
              compressedSize: (binaryResult as any).compressedSize,
              compressionRatio: (binaryResult as any).compressionRatio,
              compressionLevel:
                (binaryResult as any).metadata?.compressionLevel ?? 'standard',
            };

            this.logger.log('🗜️ Binary serialization completed', {
              requestId: context.requestId,
              compressionRatio: `${((binaryResult as any).compressionRatio * 100).toFixed(1)}%`,
              sizeSavings: `${(binaryResult as any).originalSize - (binaryResult as any).compressedSize} bytes`,
            });

            // Verify round-trip integrity
            const deserializedResult = await binarySerializer.deserialize(
              (binaryResult as any).binaryData,
            );
            if (!(deserializedResult as any).metadata?.integrityCheck) {
              this.logger.warn('Binary serialization integrity check failed', {
                requestId: context.requestId,
              });
            }
          }
        } catch (binaryError) {
          this.logger.warn(
            'Binary serialization failed, continuing without it',
            {
              requestId: context.requestId,
              error:
                binaryError instanceof Error
                  ? binaryError.message
                  : String(binaryError),
            },
          );
          binarySerializationMetadata = {
            enabled: false,
            error: String(binaryError),
          };
        }
      }

      // 🔄 Step 3: Decode back to natural language
      this.logger.debug('🔄 Gateway Cortex decoding...', {
        requestId: context.requestId,
      });
      const decodingRequest = {
        cortexStructure: (processingResult as { output: unknown }).output,
        targetLanguage: 'en',
        style: context.cortexOutputStyle || 'conversational',
        format: context.cortexOutputFormat || 'plain',
        options: {
          preserveFormatting: true,
          enhanceReadability: false,
        },
        metadata: {
          domain: 'general',
          audienceLevel: 'intermediate',
        },
      };

      const decoderService = (await this.getDecoderService()) as {
        decode?: (req: unknown) => Promise<unknown>;
      } | null;
      if (!decoderService || typeof decoderService.decode !== 'function') {
        throw new Error('Cortex decoder service not available');
      }
      const decodingResult = await decoderService.decode(decodingRequest);

      // Calculate metrics
      const originalTokens = Math.ceil(originalPrompt.length / 4);
      const decodingResultAny = decodingResult as {
        text: string;
        confidence?: number;
      };
      const optimizedTokens = Math.ceil(decodingResultAny.text.length / 4);
      const reductionPercentage =
        ((originalTokens - optimizedTokens) / originalTokens) * 100;

      const cortexMetadata = {
        processingTime: Date.now() - startTime,
        encodingConfidence: encodingResult.confidence,
        optimizationsApplied:
          (processingResult as any).optimizations?.length ?? 0,
        decodingConfidence: decodingResultAny.confidence,
        semanticIntegrity: (processingResult as any).metadata
          ?.semanticIntegrity,

        // 🎯 ADAPTIVE ROUTING METADATA
        complexity: complexityMeta,
        routing: routingMeta,

        // 🧠 CONTEXT MANAGEMENT METADATA
        contextManagement: contextState
          ? {
              enabled: true,
              sessionId,
              entitiesCount:
                (contextState as { entities?: { size: number } }).entities
                  ?.size ?? 0,
              preferencesCount:
                (contextState as { preferences?: { size: number } }).preferences
                  ?.size ?? 0,
              contextTokensSaved: 0,
              contextCompressionRatio: 1.0,
              intentionsExtracted: contextUpdateResult?.intentions?.length ?? 0,
              preferencesExtracted:
                contextUpdateResult?.preferences?.length ?? 0,
            }
          : {
              enabled: false,
              sessionId,
              entitiesCount: 0,
              preferencesCount: 0,
              contextTokensSaved: 0,
              contextCompressionRatio: 0,
              intentionsExtracted: 0,
              preferencesExtracted: 0,
              reason: 'context_management_disabled',
            },

        cortexModel: finalModelsMeta,
        tokensSaved: Math.max(0, originalTokens - optimizedTokens),
        reductionPercentage: Math.max(0, reductionPercentage),

        // 🗜️ BINARY SERIALIZATION METADATA
        binarySerialization: binarySerializationMetadata,

        schemaValidation: schemaValidationResult
          ? {
              enabled: true,
              valid: schemaValidationResult.valid,
              score: schemaValidationResult.score,
              errorCount: schemaValidationResult.errors.length,
              warningCount: schemaValidationResult.warnings.length,
              strictMode: context.cortexStrictValidation === true,
              errors: schemaValidationResult.errors.slice(0, 5),
              warnings: schemaValidationResult.warnings.slice(0, 3),
            }
          : {
              enabled: false,
              valid: false,
              score: 0,
              errorCount: 0,
              warningCount: 0,
              strictMode: false,
            },

        // 🔄 CONTROL FLOW METADATA
        controlFlow: controlFlowResult
          ? {
              enabled: true,
              success: Boolean(controlFlowResult.success),
              executedSteps: controlFlowResult.executedSteps?.length ?? 0,
              executionTime: controlFlowResult.metadata?.executionTime ?? 0,
              variablesCreated: Object.keys(controlFlowResult.variables ?? {})
                .length,
              errors: controlFlowResult.metadata?.errors?.length ?? 0,
              warnings: controlFlowResult.metadata?.warnings?.length ?? 0,
              bypassedLLM: false,
            }
          : {
              enabled: false,
              success: false,
              executedSteps: 0,
              executionTime: 0,
              variablesCreated: 0,
              errors: 0,
              warnings: 0,
            },

        // ⚡ HYBRID EXECUTION METADATA
        hybridExecution: hybridExecutionResult
          ? {
              enabled: true,
              deterministic: hybridExecutionResult.deterministic,
              executedTools: hybridExecutionResult.executedTools,
              apiCalls: hybridExecutionResult.apiCalls,
              costSaved: hybridExecutionResult.metadata.costSaved,
              executionTime: hybridExecutionResult.metadata.executionTime,
              toolsUsed: hybridExecutionResult.metadata.toolsUsed.length,
              executionType: hybridExecutionResult.executionType ?? 'llm',
              bypassedLLM: false, // Normal processing through LLM
            }
          : {
              enabled: false,
              deterministic: false,
              executedTools: [],
              apiCalls: 0,
              costSaved: 0,
              executionTime: 0,
              toolsUsed: 0,
              executionType: 'llm',
            },

        // 🧩 FRAGMENT CACHE METADATA
        fragmentCache: fragmentCacheResult
          ? {
              enabled: true,
              hit: fragmentCacheResult.hit,
              hitRate: fragmentCacheResult.metadata.hitRate,
              fragmentsFound: fragmentCacheResult.metadata.fragmentsFound,
              totalFragments: fragmentCacheResult.metadata.totalFragments,
              compressionSavings:
                fragmentCacheResult.metadata.compressionSavings,
              cacheTime: fragmentCacheResult.metadata.cacheTime,
              bypassedLLM: false, // Normal processing through LLM
            }
          : {
              enabled: false,
              hit: false,
              hitRate: 0,
              fragmentsFound: 0,
              totalFragments: 0,
              compressionSavings: 0,
              cacheTime: 0,
            },

        gateway: true,
        operation: context.cortexOperation,
      };

      // 💾 Cache the result for future use (if enabled)
      if (context.cortexSemanticCache) {
        await this.storeSemanticCache(
          originalPrompt,
          (decodingResult as { text: string }).text,
          cortexMetadata,
        );
      }

      // 🧩 Cache fragments from this processing (if enabled and successful)
      if (context.cortexFragmentCache !== false) {
        try {
          const fragmentCacheService =
            (await this.getFragmentCacheService()) as {
              cacheFragments?: (
                frame: unknown,
                result: unknown,
                time: number,
              ) => Promise<void>;
              getCacheStats?: () => { cacheSize: number };
            } | null;
          if (
            fragmentCacheService &&
            typeof fragmentCacheService.cacheFragments === 'function'
          ) {
            const processingTime = Date.now() - startTime;

            await fragmentCacheService.cacheFragments(
              encodingResult.cortexFrame,
              decodingResult as any, // Use the final processed result
              processingTime,
            );

            this.logger.log(
              '💾 Fragment caching completed for future queries',
              {
                requestId: context.requestId,
                processingTime,
                cacheSize:
                  typeof fragmentCacheService.getCacheStats === 'function'
                    ? fragmentCacheService.getCacheStats().cacheSize
                    : 0,
              },
            );
          }
        } catch (cacheError) {
          this.logger.warn('⚠️ Fragment caching failed', {
            requestId: context.requestId,
            error:
              cacheError instanceof Error
                ? cacheError.message
                : String(cacheError),
          });
        }
      }

      // Replace prompt in original body structure
      const processedBody = this.replacePromptInBody(
        originalBody,
        (decodingResult as { text: string }).text,
      );

      this.logger.log('✅ Gateway Cortex processing completed', {
        requestId: context.requestId,
        processingTime: cortexMetadata.processingTime,
        tokensSaved: cortexMetadata.tokensSaved,
        reductionPercentage: `${cortexMetadata.reductionPercentage.toFixed(1)}%`,
      });

      // Store metadata in context for response headers
      context.cortexMetadata = cortexMetadata;

      return {
        processedBody,
        cortexMetadata,
        shouldBypass: false,
      };
    } catch (error) {
      this.logger.error('❌ Gateway Cortex processing failed', {
        requestId: (request as any).gatewayContext?.requestId,
        error: error instanceof Error ? error.message : String(error),
        processingTime: Date.now() - startTime,
      });

      // Return original body on error
      return {
        processedBody: originalBody,
        cortexMetadata: {
          processingTime: Date.now() - startTime,
          gateway: true,
          error: error instanceof Error ? error.message : String(error),
        },
        shouldBypass: true,
      };
    }
  }

  // Helper methods for Cortex service integration (use optional chaining; services may be Nest injectables without getInstance)
  private async getModelRouter() {
    const { CortexModelRouterService } =
      await import('../../cortex/services/cortex-model-router.service');
    return (
      (
        CortexModelRouterService as { getInstance?: () => unknown }
      ).getInstance?.() ?? null
    );
  }

  private async getContextManager() {
    const { CortexContextManagerService } =
      await import('../../cortex/services/cortex-context-manager.service');
    return (
      (
        CortexContextManagerService as { getInstance?: () => unknown }
      ).getInstance?.() ?? null
    );
  }

  private async getEncoderService() {
    const { CortexEncoderService } =
      await import('../../cortex/services/cortex-encoder.service');
    return (
      (
        CortexEncoderService as { getInstance?: () => unknown }
      ).getInstance?.() ?? null
    );
  }

  private async getSchemaValidator() {
    const { CortexSchemaValidatorService } =
      await import('../../cortex/services/cortex-schema-validator.service');
    return (
      (
        CortexSchemaValidatorService as { getInstance?: () => unknown }
      ).getInstance?.() ?? null
    );
  }

  private async getFragmentCacheService() {
    const { CortexFragmentCacheService } =
      await import('../../cortex/services/cortex-fragment-cache.service');
    return (
      (
        CortexFragmentCacheService as { getInstance?: () => unknown }
      ).getInstance?.() ?? null
    );
  }

  private async getHybridEngine() {
    const mod =
      await import('../../cortex/services/cortex-hybrid-engine.service');
    const Service =
      mod.CortexHybridEngineService ??
      (mod as { default?: { getInstance?: () => unknown } }).default;
    if (
      Service &&
      typeof (Service as unknown as { getInstance?: () => unknown })
        .getInstance === 'function'
    ) {
      return (
        Service as unknown as { getInstance: () => unknown }
      ).getInstance();
    }
    return null;
  }

  private async getControlFlowService() {
    const { CortexControlFlowService } =
      await import('../../cortex/services/cortex-control-flow.service');
    return (
      (
        CortexControlFlowService as { getInstance?: () => unknown }
      ).getInstance?.() ?? null
    );
  }

  private async getCoreService() {
    const { CortexCoreService } =
      await import('../../cortex/services/cortex-core.service');
    return (
      (CortexCoreService as { getInstance?: () => unknown }).getInstance?.() ??
      null
    );
  }

  private async getBinarySerializer() {
    const { CortexBinarySerializerService } =
      await import('../../cortex/services/cortex-binary-serializer.service');
    return (
      (
        CortexBinarySerializerService as { getInstance?: () => unknown }
      ).getInstance?.() ?? null
    );
  }

  private async getDecoderService() {
    const { CortexDecoderService } =
      await import('../../cortex/services/cortex-decoder.service');
    return (
      (
        CortexDecoderService as { getInstance?: () => unknown }
      ).getInstance?.() ?? null
    );
  }

  private async checkSemanticCache(prompt: string) {
    const { CortexCacheService } =
      await import('../../cortex/services/cortex-cache.service');
    return (
      (await (
        CortexCacheService as {
          getCachedResult?: (p: string) => Promise<unknown>;
        }
      ).getCachedResult?.(prompt)) ?? null
    );
  }

  private async storeSemanticCache(
    prompt: string,
    optimizedPrompt: string,
    metadata: any,
  ) {
    const { CortexCacheService } =
      await import('../../cortex/services/cortex-cache.service');
    await (
      CortexCacheService as {
        setCachedResult?: (p: string, o: string, m: any) => Promise<void>;
      }
    ).setCachedResult?.(prompt, optimizedPrompt, metadata);
  }

  // Utility methods
  private extractPromptFromBody(body: any): string | null {
    // OpenAI Chat Completions format
    if (body.messages && Array.isArray(body.messages)) {
      const lastMessage = body.messages[body.messages.length - 1];
      if (lastMessage && lastMessage.content) {
        return typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      }
    }

    // Anthropic Messages format
    if (body.messages && Array.isArray(body.messages)) {
      const userMessages = body.messages.filter(
        (msg: any) => msg.role === 'user',
      );
      if (userMessages.length > 0) {
        const lastUserMessage = userMessages[userMessages.length - 1];
        return lastUserMessage.content;
      }
    }

    // Simple prompt format
    if (body.prompt && typeof body.prompt === 'string') {
      return body.prompt;
    }

    // Input field
    if (body.input && typeof body.input === 'string') {
      return body.input;
    }

    // Text field
    if (body.text && typeof body.text === 'string') {
      return body.text;
    }

    return null;
  }

  private replacePromptInBody(originalBody: any, newPrompt: string): any {
    const body = JSON.parse(JSON.stringify(originalBody)); // Deep clone

    // OpenAI Chat Completions format
    if (body.messages && Array.isArray(body.messages)) {
      const lastMessage = body.messages[body.messages.length - 1];
      if (lastMessage && lastMessage.content) {
        lastMessage.content = newPrompt;
        return body;
      }
    }

    // Simple prompt format
    if (body.prompt && typeof body.prompt === 'string') {
      body.prompt = newPrompt;
      return body;
    }

    // Input field
    if (body.input && typeof body.input === 'string') {
      body.input = newPrompt;
      return body;
    }

    // Text field
    if (body.text && typeof body.text === 'string') {
      body.text = newPrompt;
      return body;
    }

    return body;
  }

  private inferPriorityFromContext(
    context: any,
  ): 'cost' | 'speed' | 'quality' | 'balanced' {
    // Check for explicit priority header
    if (context.cortexPriority) {
      return context.cortexPriority;
    }

    // Infer from operation type
    if (context.cortexOperation === 'compress') {
      return 'cost'; // Focus on token reduction
    }

    if (context.cortexOperation === 'analyze') {
      return 'quality'; // Focus on accuracy
    }

    // Default to balanced
    return 'balanced';
  }

  private getTargetReduction(
    complexity: 'simple' | 'medium' | 'complex' | 'expert',
  ): number {
    const reductionMap = {
      simple: 40, // Aggressive compression for simple prompts
      medium: 30, // Balanced compression
      complex: 20, // Conservative compression for complex prompts
      expert: 15, // Minimal compression to preserve nuance
    };

    return reductionMap[complexity] || 25;
  }

  private isControlFlowFrame(frame: any): boolean {
    const controlFlowTypes = ['control', 'conditional', 'loop', 'sequence'];
    return controlFlowTypes.includes(frame.frameType);
  }

  // Format result methods
  private formatFragmentResult(fragment: any): string {
    const parts = [];

    parts.push(`Fragment cache hit: ${fragment.metadata.category}`);

    if (
      typeof fragment.content === 'string' ||
      typeof fragment.content === 'number'
    ) {
      parts.push(`Cached result: ${fragment.content}`);
    } else if (
      typeof fragment.content === 'object' &&
      fragment.content !== null
    ) {
      if ('frameType' in fragment.content) {
        parts.push(`Cached ${fragment.content.frameType} frame`);
        // Add content details
        Object.entries(fragment.content).forEach(([key, value]) => {
          if (key !== 'frameType') {
            parts.push(`${key}: ${value}`);
          }
        });
      } else {
        parts.push(
          `Cached content: ${JSON.stringify(fragment.content, null, 2)}`,
        );
      }
    }

    parts.push(
      `Reusability: ${(fragment.metadata.reusability * 100).toFixed(1)}%`,
    );
    parts.push(`Access count: ${fragment.metadata.accessCount}`);
    parts.push(
      `Compression savings: ${(fragment.metadata.compressionRatio * 100).toFixed(1)}%`,
    );

    return parts.join('\n');
  }

  private formatHybridResult(result: any): string {
    if (!result.success) {
      return `Hybrid execution failed: ${result.metadata.errors.join(', ')}`;
    }

    if (result.deterministic) {
      // Format deterministic execution result
      const parts = [];

      if (
        typeof result.result === 'string' ||
        typeof result.result === 'number'
      ) {
        parts.push(`Result: ${result.result}`);
      } else if (typeof result.result === 'object' && result.result !== null) {
        if ('frameType' in result.result) {
          parts.push(
            `Executed ${result.result.frameType} frame deterministically`,
          );
        } else {
          parts.push(`Result: ${JSON.stringify(result.result, null, 2)}`);
        }
      }

      if (result.executedTools.length > 0) {
        parts.push(`Tools used: ${result.executedTools.join(', ')}`);
      }

      if (result.metadata.costSaved > 0) {
        parts.push(`Cost saved: ${result.metadata.costSaved} tokens`);
      }

      parts.push(`Execution time: ${result.metadata.executionTime}ms`);

      return parts.join('\n');
    }

    // Hybrid execution (partial deterministic)
    const summary = [
      'Hybrid execution completed',
      `Tools executed: ${result.executedTools.join(', ')}`,
      `API calls made: ${result.apiCalls}`,
      `Cost saved: ${result.metadata.costSaved} tokens`,
      `Execution time: ${result.metadata.executionTime}ms`,
    ];

    if (result.metadata.toolsUsed.length > 0) {
      summary.push(
        `Tool results: ${result.metadata.toolsUsed.map((t: any) => `${t.toolName}: ${t.success ? 'success' : 'failed'}`).join(', ')}`,
      );
    }

    return summary.join('\n');
  }

  private formatControlFlowResult(result: any): string {
    if (!result.success) {
      return `Control flow execution failed: ${result.metadata.errors.map((e: any) => e.message).join(', ')}`;
    }

    // Format the result based on type
    if (typeof result.result === 'string') {
      return result.result;
    }

    if (Array.isArray(result.result)) {
      // Format array results
      const formattedResults = result.result
        .map((item: any, index: number) => {
          if (
            typeof item === 'object' &&
            item !== null &&
            'frameType' in item
          ) {
            return `Step ${index + 1}: ${item.frameType} frame executed`;
          }
          return `Step ${index + 1}: ${JSON.stringify(item)}`;
        })
        .join('\n');

      return formattedResults;
    }

    if (typeof result.result === 'object' && result.result !== null) {
      // Format object results
      if (result.result.frameType) {
        return `Executed ${result.result.frameType} frame with ${result.executedSteps.length} steps`;
      }
      return JSON.stringify(result.result, null, 2);
    }

    // Fallback: format execution summary
    const summary = [
      `Control flow execution completed successfully`,
      `Executed ${result.executedSteps.length} steps`,
      `Variables created: ${Object.keys(result.variables).length}`,
      `Execution time: ${result.metadata.executionTime}ms`,
    ];

    if (Object.keys(result.variables).length > 0) {
      summary.push(
        `Final variables: ${JSON.stringify(result.variables, null, 2)}`,
      );
    }

    return summary.join('\n');
  }

  /**
   * Add Cortex metadata to response headers
   */
  addCortexResponseHeaders(response: Response, context: any): void {
    if (context.cortexMetadata) {
      const metadata = context.cortexMetadata;

      response.setHeader('CostKatana-Cortex-Enabled', 'true');
      response.setHeader(
        'CostKatana-Cortex-Processing-Time',
        metadata.processingTime.toString(),
      );
      response.setHeader(
        'CostKatana-Cortex-Tokens-Saved',
        metadata.tokensSaved?.toString() || '0',
      );
      response.setHeader(
        'CostKatana-Cortex-Reduction-Percentage',
        metadata.reductionPercentage?.toFixed(1) || '0.0',
      );
      response.setHeader(
        'CostKatana-Cortex-Semantic-Integrity',
        metadata.semanticIntegrity?.toFixed(3) || '1.000',
      );

      if (metadata.cacheHit) {
        response.setHeader('CostKatana-Cortex-Cache-Hit', 'true');
        response.setHeader(
          'CostKatana-Cortex-Original-Processing-Time',
          metadata.originalCacheTime?.toString() || '0',
        );
      }

      if (metadata.cortexModel) {
        response.setHeader(
          'CostKatana-Cortex-Models',
          JSON.stringify(metadata.cortexModel),
        );
      }

      // 🗜️ Binary serialization headers
      if (
        metadata.binarySerialization &&
        metadata.binarySerialization.enabled
      ) {
        response.setHeader('CostKatana-Cortex-Binary-Enabled', 'true');
        response.setHeader(
          'CostKatana-Cortex-Binary-Compression-Ratio',
          (metadata.binarySerialization.compressionRatio * 100).toFixed(1) +
            '%',
        );
        response.setHeader(
          'CostKatana-Cortex-Binary-Size-Savings',
          (
            metadata.binarySerialization.originalSize -
            metadata.binarySerialization.compressedSize
          ).toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Binary-Compression-Level',
          metadata.binarySerialization.compressionLevel,
        );
      }

      // 🎯 Adaptive routing headers
      if (metadata.routing) {
        response.setHeader(
          'CostKatana-Cortex-Routing-Tier',
          metadata.routing.selectedTier,
        );
        response.setHeader(
          'CostKatana-Cortex-Complexity-Level',
          metadata.complexity.level,
        );
        response.setHeader(
          'CostKatana-Cortex-Complexity-Score',
          metadata.complexity.score.toString(),
        );
      }

      // 🔍 Schema validation headers
      if (metadata.schemaValidation && metadata.schemaValidation.enabled) {
        response.setHeader(
          'CostKatana-Cortex-Schema-Valid',
          metadata.schemaValidation.valid.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Schema-Score',
          metadata.schemaValidation.score.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Schema-Errors',
          metadata.schemaValidation.errorCount.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Schema-Warnings',
          metadata.schemaValidation.warningCount.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Schema-Strict',
          metadata.schemaValidation.strictMode.toString(),
        );
      }

      // 🔄 Control flow headers
      if (metadata.controlFlow && metadata.controlFlow.enabled) {
        response.setHeader('CostKatana-Cortex-ControlFlow-Enabled', 'true');
        response.setHeader(
          'CostKatana-Cortex-ControlFlow-Success',
          metadata.controlFlow.success.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-ControlFlow-Steps',
          metadata.controlFlow.executedSteps.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-ControlFlow-ExecutionTime',
          metadata.controlFlow.executionTime.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-ControlFlow-Variables',
          metadata.controlFlow.variablesCreated.toString(),
        );
        if (metadata.controlFlow.bypassedLLM) {
          response.setHeader(
            'CostKatana-Cortex-ControlFlow-BypassedLLM',
            'true',
          );
        }
      }

      // ⚡ Hybrid execution headers
      if (metadata.hybridExecution && metadata.hybridExecution.enabled) {
        response.setHeader('CostKatana-Cortex-Hybrid-Enabled', 'true');
        response.setHeader(
          'CostKatana-Cortex-Hybrid-Deterministic',
          metadata.hybridExecution.deterministic.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Hybrid-ExecutedTools',
          metadata.hybridExecution.executedTools.join(','),
        );
        response.setHeader(
          'CostKatana-Cortex-Hybrid-ApiCalls',
          metadata.hybridExecution.apiCalls.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Hybrid-CostSaved',
          metadata.hybridExecution.costSaved.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Hybrid-ExecutionTime',
          metadata.hybridExecution.executionTime.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Hybrid-ToolsUsed',
          metadata.hybridExecution.toolsUsed.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Hybrid-ExecutionType',
          metadata.hybridExecution.executionType,
        );
        if (metadata.hybridExecution.bypassedLLM) {
          response.setHeader('CostKatana-Cortex-Hybrid-BypassedLLM', 'true');
        }
      }

      // 🧠 Context management headers
      if (metadata.contextManagement && metadata.contextManagement.enabled) {
        response.setHeader('CostKatana-Cortex-Context-Enabled', 'true');
        response.setHeader(
          'CostKatana-Cortex-Context-SessionId',
          metadata.contextManagement.sessionId,
        );
        response.setHeader(
          'CostKatana-Cortex-Context-EntitiesCount',
          metadata.contextManagement.entitiesCount.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Context-PreferencesCount',
          metadata.contextManagement.preferencesCount.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Context-TokensSaved',
          metadata.contextManagement.contextTokensSaved.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Context-CompressionRatio',
          (metadata.contextManagement.contextCompressionRatio * 100).toFixed(1),
        );
        response.setHeader(
          'CostKatana-Cortex-Context-EntitiesExtracted',
          metadata.contextManagement.entitiesExtracted.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-Context-IntentionsExtracted',
          metadata.contextManagement.intentionsExtracted.toString(),
        );
        if (metadata.contextManagement.compressionApplied) {
          response.setHeader(
            'CostKatana-Cortex-Context-CompressionApplied',
            'true',
          );
        }
      }

      // 🧩 Fragment cache headers
      if (metadata.fragmentCache && metadata.fragmentCache.enabled) {
        response.setHeader('CostKatana-Cortex-FragmentCache-Enabled', 'true');
        response.setHeader(
          'CostKatana-Cortex-FragmentCache-Hit',
          metadata.fragmentCache.hit.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-FragmentCache-HitRate',
          (metadata.fragmentCache.hitRate * 100).toFixed(1),
        );
        response.setHeader(
          'CostKatana-Cortex-FragmentCache-FragmentsFound',
          metadata.fragmentCache.fragmentsFound.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-FragmentCache-TotalFragments',
          metadata.fragmentCache.totalFragments.toString(),
        );
        response.setHeader(
          'CostKatana-Cortex-FragmentCache-CompressionSavings',
          (metadata.fragmentCache.compressionSavings * 100).toFixed(1),
        );
        response.setHeader(
          'CostKatana-Cortex-FragmentCache-CacheTime',
          metadata.fragmentCache.cacheTime.toString(),
        );

        if (metadata.fragmentCache.fragmentId) {
          response.setHeader(
            'CostKatana-Cortex-FragmentCache-FragmentId',
            metadata.fragmentCache.fragmentId,
          );
          response.setHeader(
            'CostKatana-Cortex-FragmentCache-Category',
            metadata.fragmentCache.category || 'unknown',
          );
        }

        if (
          metadata.fragmentCache.composition &&
          metadata.fragmentCache.composition.enabled
        ) {
          response.setHeader(
            'CostKatana-Cortex-FragmentCache-Composition-Enabled',
            'true',
          );
          response.setHeader(
            'CostKatana-Cortex-FragmentCache-Composition-Coverage',
            (metadata.fragmentCache.composition.coverageRatio * 100).toFixed(1),
          );
          response.setHeader(
            'CostKatana-Cortex-FragmentCache-Composition-FragmentCount',
            metadata.fragmentCache.composition.fragmentCount.toString(),
          );
          response.setHeader(
            'CostKatana-Cortex-FragmentCache-Composition-Strategy',
            metadata.fragmentCache.composition.strategy,
          );
          response.setHeader(
            'CostKatana-Cortex-FragmentCache-Composition-MissingParts',
            metadata.fragmentCache.composition.missingParts.toString(),
          );
        }

        if (metadata.fragmentCache.bypassedLLM) {
          response.setHeader(
            'CostKatana-Cortex-FragmentCache-BypassedLLM',
            'true',
          );
        }
      }
    }
  }
}
