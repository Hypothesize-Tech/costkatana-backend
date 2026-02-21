import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { OptimizationService } from '../services/optimization.service';
import { optimizationRequestSchema, paginationSchema } from '../utils/validators';
import { loggingService } from '../services/logging.service';
import { S3Service } from '../services/s3.service';
import { PromptCompilerService } from '../compiler/promptCompiler.service';
import { ParallelExecutionOptimizerService } from '../compiler/parallelExecutionOptimizer.service';
import { ProactiveSuggestionsService } from '../services/proactiveSuggestions.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

/**
 * Model mapping from short names to full AWS Bedrock model IDs
 */
const mapToFullModelId = (shortName?: string): string | undefined => {
    if (!shortName) return undefined;
    
    const modelMap: Record<string, string> = {
        // Claude 3.5 models (upgraded)
        'claude-3-haiku': 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        'claude-3-5-haiku': 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        'claude-3-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'claude-3-5-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        
        // Claude 4.6 and Claude 4 models
        'claude-opus-4-6': 'anthropic.claude-opus-4-6-v1',
        'claude-sonnet-4-6': 'anthropic.claude-sonnet-4-6-v1:0',
        'claude-4': 'anthropic.claude-opus-4-1-20250805-v1:0',
        'claude-opus-4': 'anthropic.claude-opus-4-1-20250805-v1:0',
        
        // Nova models
        'nova-pro': 'amazon.nova-pro-v1:0',
        'nova-lite': 'amazon.nova-lite-v1:0',
        'nova-micro': 'amazon.nova-micro-v1:0',
        
        // Full model IDs (pass through)
        'global.anthropic.claude-haiku-4-5-20251001-v1:0': 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        'anthropic.claude-3-5-sonnet-20240620-v1:0': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'anthropic.claude-opus-4-6-v1': 'anthropic.claude-opus-4-6-v1',
        'anthropic.claude-sonnet-4-6-v1:0': 'anthropic.claude-sonnet-4-6-v1:0',
        'anthropic.claude-opus-4-1-20250805-v1:0': 'anthropic.claude-opus-4-1-20250805-v1:0',
        'amazon.nova-pro-v1:0': 'amazon.nova-pro-v1:0'
    };
    
    return modelMap[shortName] || shortName;
};

/**
 * Build requestTracking for an optimization API request (same shape as Usage.requestTracking).
 * Used so the dashboard can show "Network Details" for each optimization run.
 */
function buildOptimizationRequestTracking(
    req: AuthenticatedRequest,
    totalRoundTripTimeMs: number,
    requestSize: number,
    responseSize: number
): Record<string, unknown> {
    const protocol = req.protocol ?? 'https';
    const host = req.get('host') ?? '';
    const fullUrl = `${protocol}://${host}${req.originalUrl ?? req.url ?? '/api/optimizations'}`;
    const socket = req.socket as { remoteAddress?: string; localAddress?: string; localPort?: number } | undefined;
    return {
        clientInfo: {
            ip: req.ip ?? socket?.remoteAddress ?? 'unknown',
            userAgent: req.get('user-agent') ?? 'unknown',
            forwardedIPs: (req.get('x-forwarded-for') ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
        },
        headers: {
            request: {
                'content-type': req.get('content-type') ?? 'application/json',
                'accept': req.get('accept') ?? '*/*',
            },
            response: { 'content-type': 'application/json' },
        },
        networking: {
            serverEndpoint: req.originalUrl ?? req.url ?? '/api/optimizations',
            serverFullUrl: fullUrl,
            clientOrigin: req.get('origin') ?? req.get('referer') ?? 'Dashboard',
            serverIP: socket?.localAddress ?? '0.0.0.0',
            serverPort: socket?.localPort ?? 0,
            routePattern: '/api/optimizations',
            protocol,
            secure: protocol === 'https',
        },
        payload: {
            requestSize,
            responseSize,
            contentType: 'application/json',
        },
        performance: {
            totalRoundTripTime: totalRoundTripTimeMs,
            serverProcessingTime: totalRoundTripTimeMs,
            networkTime: 0,
            dataTransferEfficiency: totalRoundTripTimeMs > 0 ? (requestSize + responseSize) / (totalRoundTripTimeMs / 1000) : 0,
        },
    };
}

import { Optimization } from '../models';


export class OptimizationController {
    static async createOptimization(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('createOptimization', req);

        try {

            const validatedData = optimizationRequestSchema.parse(req.body);

            loggingService.info('Optimization creation processing started', {
                userId,
                hasValidatedData: !!validatedData,
                hasConversationHistory: !!req.body.conversationHistory,
                enableCompression: req.body.enableCompression !== false,
                enableContextTrimming: req.body.enableContextTrimming !== false,
                enableRequestFusion: req.body.enableRequestFusion !== false,
                enableCortex: req.body.enableCortex === true,
                cortexOperation: 'answer', // NEW ARCHITECTURE: Always answer generation,
                cortexStyle: req.body.cortexStyle || 'conversational',
                requestId: req.headers['x-request-id'] as string
            });

            // Conditional debug logging only in development
                loggingService.debug('Cortex enablement check', {
                    enableCortex: req.body.enableCortex,
                    validatedEnableCortex: validatedData.enableCortex,
                    requestId: req.headers['x-request-id'] as string
                });

            // 🚀 P2: Prompt compiler integration - PRODUCTION READY
            let optimizedPrompt = validatedData.prompt;
            let promptCompilationMetadata: any = undefined;
            
            const enableCompiler = req.headers['x-costkatana-enable-compiler'] === 'true' || req.query.enableCompiler === 'true';
            const optimizationLevel = parseInt(req.headers['x-costkatana-optimization-level'] as string) || 2;
            
            if (enableCompiler && validatedData.prompt && validatedData.prompt.length > 150) {
                try {
                    loggingService.info('🔧 Prompt compiler processing started', {
                        userId,
                        promptLength: validatedData.prompt.length,
                        optimizationLevel,
                        requestId: req.headers['x-request-id'] as string
                    });
                    
                    const compilationResult = await PromptCompilerService.compile(validatedData.prompt, {
                        optimizationLevel: optimizationLevel as 0 | 1 | 2 | 3,
                        preserveQuality: true,
                        enableParallelization: true
                    });
                    
                    if (compilationResult.success && compilationResult.metrics.tokenReduction > 5) {
                        optimizedPrompt = compilationResult.optimizedPrompt;
                        promptCompilationMetadata = {
                            originalTokens: compilationResult.metrics.originalTokens,
                            optimizedTokens: compilationResult.metrics.optimizedTokens,
                            tokenReduction: compilationResult.metrics.tokenReduction,
                            optimizationPasses: compilationResult.metrics.optimizationPasses.map(p => ({
                                pass: p.passName,
                                applied: p.applied,
                                transformations: p.transformations.length
                            })),
                            parallelizationAnalysis: compilationResult.ast ? 
                                ParallelExecutionOptimizerService.analyzeParallelizationOpportunities(compilationResult.ast) : 
                                undefined
                        };
                        
                        loggingService.info('✅ Prompt compiler optimization successful', {
                            userId,
                            originalTokens: compilationResult.metrics.originalTokens,
                            optimizedTokens: compilationResult.metrics.optimizedTokens,
                            reduction: `${compilationResult.metrics.tokenReduction.toFixed(1)}%`,
                            passes: compilationResult.metrics.optimizationPasses.length,
                            parallelizationPct: promptCompilationMetadata.parallelizationAnalysis?.parallelizationPercentage,
                            requestId: req.headers['x-request-id'] as string
                        });
                    } else {
                        loggingService.info('Prompt compiler: No significant optimization found', {
                            userId,
                            reduction: compilationResult.metrics.tokenReduction,
                            requestId: req.headers['x-request-id'] as string
                        });
                    }
                } catch (error) {
                    loggingService.warn('Prompt compiler failed, using original prompt', {
                        userId,
                        error: error instanceof Error ? error.message : String(error),
                        requestId: req.headers['x-request-id'] as string
                    });
                }
            }
            
            // 🚀 P1: Generate proactive suggestions after optimization
            const generateSuggestions = req.headers['x-costkatana-proactive-suggestions'] !== 'false';

            const optimization = await OptimizationService.createOptimization({
                userId,
                prompt: optimizedPrompt, // Use compiler-optimized prompt if available
                service: validatedData.service,
                model: validatedData.model,
                context: validatedData.context,
                conversationHistory: req.body.conversationHistory,
                useCortex: req.body.useCortex || false,  // Enable Cortex if requested
                options: {
                    ...validatedData.options,
                    enableCompression: req.body.enableCompression !== false,
                    enableContextTrimming: req.body.enableContextTrimming !== false,
                    enableRequestFusion: req.body.enableRequestFusion !== false,
                    
                    // 🚀 CORTEX OPTIONS
                    enableCortex: req.body.useCortex === true || req.body.enableCortex === true,
                    cortexConfig: (req.body.useCortex === true || req.body.enableCortex === true) ? {
                        encodingModel: mapToFullModelId(req.body.cortexEncodingModel) || 'amazon.nova-pro-v1:0', // Nova Pro default
                        coreProcessingModel: mapToFullModelId(req.body.cortexCoreModel) || 'anthropic.claude-opus-4-1-20250805-v1:0', // Claude 4 default
                        decodingModel: mapToFullModelId(req.body.cortexDecodingModel) || 'amazon.nova-pro-v1:0', // Nova Pro default
                        processingOperation: 'answer', // NEW ARCHITECTURE: Always answer generation,
                        outputStyle: req.body.cortexStyle || 'conversational',
                        outputFormat: req.body.cortexFormat || 'plain',
                        enableSemanticCache: req.body.cortexSemanticCache !== false,
                        enableStructuredContext: req.body.cortexStructuredContext === true,
                        preserveSemantics: true, // Always preserve semantics in answer generation,
                        enableIntelligentRouting: req.body.cortexIntelligentRouting === true
                    } : undefined
                }
            });

            // 🚀 Generate proactive suggestions asynchronously (non-blocking)
            if (generateSuggestions && optimization.tokensSaved && optimization.tokensSaved > 0) {
                ProactiveSuggestionsService.pushOptimizationCompletedSuggestion(
                    userId,
                    optimization.tokensSaved,
                    optimization.costSaved || 0,
                    optimization.improvementPercentage || 0
                ).catch((error: Error) => {
                    loggingService.warn('Failed to generate proactive suggestions', {
                        error: error.message,
                        userId,
                        requestId: req.headers['x-request-id'] as string
                    });
                });
            }

            // Attach request/network details for Optimization Details modal (same pattern as Usage).
            const totalRoundTripTimeMs = Date.now() - startTime;
            let requestTracking: Record<string, unknown> | undefined;
            try {
                const requestBodyStr = JSON.stringify(req.body ?? {});
                const responsePayload = {
                    id: optimization._id,
                    userQuery: optimization.userQuery,
                    generatedAnswer: optimization.generatedAnswer,
                    improvementPercentage: optimization.improvementPercentage,
                    costSaved: optimization.costSaved,
                    tokensSaved: optimization.tokensSaved,
                };
                const responseBodyStr = JSON.stringify(responsePayload);
                requestTracking = buildOptimizationRequestTracking(
                    req,
                    totalRoundTripTimeMs,
                    Buffer.byteLength(requestBodyStr, 'utf8'),
                    Buffer.byteLength(responseBodyStr, 'utf8')
                ) as Record<string, unknown>;
                await Optimization.findByIdAndUpdate(optimization._id, { requestTracking });
            } catch (err) {
                loggingService.warn('Failed to attach requestTracking to optimization', {
                    optimizationId: optimization._id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }

            ControllerHelper.logRequestSuccess('createOptimization', req, startTime, {
                optimizationId: optimization._id,
                improvementPercentage: optimization.improvementPercentage,
                costSaved: optimization.costSaved,
                tokensSaved: optimization.tokensSaved,
                promptCompilationApplied: !!promptCompilationMetadata,
                hasRequestTracking: !!requestTracking,
            });

            ControllerHelper.logBusinessEvent(
                'optimization_created',
                'optimization_operations',
                userId,
                Date.now() - startTime,
                {
                    optimizationId: optimization._id,
                    hasUserQuery: !!optimization.userQuery,
                    hasGeneratedAnswer: !!optimization.generatedAnswer,
                    improvementPercentage: optimization.improvementPercentage,
                    costSaved: optimization.costSaved,
                    tokensSaved: optimization.tokensSaved,
                    hasSuggestions: !!optimization.suggestions,
                    hasMetadata: !!optimization.metadata
                }
            );

            res.status(201).json({
                success: true,
                message: 'Optimization created successfully',
                data: {
                    id: optimization._id,
                    _id: optimization._id,
                    userQuery: optimization.userQuery,
                    generatedAnswer: optimization.generatedAnswer,
                    improvementPercentage: optimization.improvementPercentage,
                    costSaved: optimization.costSaved,
                    tokensSaved: optimization.tokensSaved,
                    suggestions: optimization.suggestions,
                    metadata: optimization.metadata,
                    requestTracking: requestTracking ?? undefined,

                    // 🚀 CORTEX METADATA in response
                    cortexEnabled: optimization.metadata?.cortexEnabled || false,
                    cortexProcessingTime: optimization.metadata?.cortexProcessingTime,
                    cortexSemanticIntegrity: optimization.metadata?.cortexSemanticIntegrity,
                    cortexTokenReduction: optimization.metadata?.cortexTokenReduction
                },
            });
        } catch (error: any) {
            ControllerHelper.handleError('createOptimization', error, req, res, startTime);
            next(error);
        }
    }

    static async getOptimizations(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getOptimizations', req);

        try {

            const { page, limit, sort, order } = paginationSchema.parse(req.query);

            const filters = {
                userId,
                // Removed applied filter - no longer needed
                category: req.query.category as string,
                minSavings: req.query.minSavings ? parseFloat(req.query.minSavings as string) : undefined,
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
            };

            loggingService.info('Optimizations retrieval processing started', {
                userId,
                page,
                limit,
                sort,
                order,
                // Removed applied filter logging
                category: req.query.category,
                hasMinSavings: !!req.query.minSavings,
                minSavings: req.query.minSavings,
                hasStartDate: !!req.query.startDate,
                startDate: req.query.startDate,
                hasEndDate: !!req.query.endDate,
                endDate: req.query.endDate,
                requestId: req.headers['x-request-id'] as string
            });

            const result = await OptimizationService.getOptimizations(filters, {
                page,
                limit,
                sort,
                order,
            });

            // Generate pre-signed URLs for visual compliance images
            const dataWithPresignedUrls = await Promise.all(
                result.data.map(async (opt: any) => {
                    if (opt.optimizationType === 'visual_compliance' && opt.visualComplianceData) {
                        try {
                            const presignedData: any = { ...opt.visualComplianceData };
                            
                            // Generate pre-signed URL for reference image
                            if (opt.visualComplianceData.referenceImageUrl) {
                                const refKey = S3Service.s3UrlToKey(opt.visualComplianceData.referenceImageUrl);
                                presignedData.referenceImagePresignedUrl = await S3Service.getPresignedDocumentUrl(refKey, 3600);
                            }
                            
                            // Generate pre-signed URL for evidence image
                            if (opt.visualComplianceData.evidenceImageUrl) {
                                const evidKey = S3Service.s3UrlToKey(opt.visualComplianceData.evidenceImageUrl);
                                presignedData.evidenceImagePresignedUrl = await S3Service.getPresignedDocumentUrl(evidKey, 3600);
                            }
                            
                            return {
                                ...opt.toObject ? opt.toObject() : opt,
                                visualComplianceData: presignedData
                            };
                        } catch (error) {
                            loggingService.warn('Failed to generate pre-signed URLs', {
                                optimizationId: opt._id,
                                error: error instanceof Error ? error.message : String(error)
                            });
                            return opt;
                        }
                    }
                    return opt;
                })
            );

            ControllerHelper.logRequestSuccess('getOptimizations', req, startTime, {
                page,
                limit,
                optimizationsCount: result.data.length,
                totalPages: result.pagination?.pages,
                totalCount: result.pagination?.total
            });

            ControllerHelper.logBusinessEvent(
                'optimizations_retrieved',
                'optimization_operations',
                userId,
                Date.now() - startTime,
                {
                    page,
                    limit,
                    sort,
                    order,
                    optimizationsCount: result.data.length,
                    hasOptimizations: !!result.data && result.data.length > 0,
                    hasPagination: !!result.pagination,
                    totalPages: result.pagination?.pages,
                    totalCount: result.pagination?.total
                }
            );

            res.json({
                success: true,
                data: dataWithPresignedUrls,
                pagination: result.pagination,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getOptimizations', error, req, res, startTime);
            next(error);
        }
    }

    static async getOptimization(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        const { id } = req.params;
        ControllerHelper.logRequestStart('getOptimization', req);

        try {
            // Validate MongoDB ObjectId
            ServiceHelper.validateObjectId(id, 'Optimization ID');

            const result = await OptimizationService.getOptimizations(
                { userId },
                { page: 1, limit: 1 }
            );

            const optimization = result.data.find((o: any) => o._id.toString() === id);

            if (!optimization) {
                ControllerHelper.logRequestSuccess('getOptimization', req, startTime, { optimizationId: id, found: false });
                res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
                return;
            }

            ControllerHelper.logRequestSuccess('getOptimization', req, startTime, {
                optimizationId: id,
                improvementPercentage: (optimization as any)?.improvementPercentage,
                costSaved: (optimization as any)?.costSaved,
                tokensSaved: (optimization as any)?.tokensSaved
            });

            ControllerHelper.logBusinessEvent(
                'individual_optimization_retrieved',
                'optimization_operations',
                userId,
                undefined,
                {
                    optimizationId: id,
                    improvementPercentage: (optimization as any)?.improvementPercentage,
                    costSaved: (optimization as any)?.costSaved,
                    tokensSaved: (optimization as any)?.tokensSaved
                }
            );

            // Keep existing response format (backward compatibility)
            res.json({
                success: true,
                data: optimization,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getOptimization', error, req, res, startTime);
            next(error);
        }
    }

    /**
     * Get network/request details for an optimization (same shape as Usage network-details).
     * Used for lazy load when opening Optimization Details modal from list/card.
     */
    static async getOptimizationNetworkDetails(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { id } = req.params;
        ControllerHelper.logRequestStart('getOptimizationNetworkDetails', req);

        try {
            ServiceHelper.validateObjectId(id, 'Optimization ID');

            const optimization = await Optimization.findOne({
                _id: id,
                userId,
            }).select('requestTracking metadata').lean();

            if (!optimization) {
                res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
                return;
            }

            const requestTracking = (optimization as any).requestTracking;
            const networkDetails = {
                requestTracking,
                performance: requestTracking?.performance
                    ? { responseTime: requestTracking.performance.serverProcessingTime ?? requestTracking.performance.totalRoundTripTime, networkMetrics: requestTracking.performance }
                    : undefined,
                clientInfo: requestTracking?.clientInfo,
            };

            ControllerHelper.logRequestSuccess('getOptimizationNetworkDetails', req, startTime, {
                optimizationId: id,
                hasRequestTracking: !!requestTracking,
            });

            res.json({
                success: true,
                data: networkDetails,
                metadata: { optimizationId: id, generatedAt: new Date().toISOString() },
            });
        } catch (error: any) {
            ControllerHelper.handleError('getOptimizationNetworkDetails', error, req, res, startTime);
            next(error);
        }
    }

    static async applyOptimization(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { id } = req.params;
        ControllerHelper.logRequestStart('applyOptimization', req);

        try {
            ServiceHelper.validateObjectId(id, 'Optimization ID');

            await OptimizationService.applyOptimization(id, userId);

            ControllerHelper.logRequestSuccess('applyOptimization', req, startTime, {
                optimizationId: id
            });

            ControllerHelper.logBusinessEvent(
                'optimization_applied',
                'optimization_operations',
                userId,
                Date.now() - startTime,
                { optimizationId: id }
            );

            res.json({
                success: true,
                message: 'Optimization applied successfully',
            });
        } catch (error: any) {
            if (error.message === 'Optimization not found') {
                res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
                return;
            }
            ControllerHelper.handleError('applyOptimization', error, req, res, startTime);
            next(error);
        }
    }

    static async provideFeedback(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { id } = req.params;
        const { helpful, rating, comment } = req.body;
        ControllerHelper.logRequestStart('provideFeedback', req);

        try {
            ServiceHelper.validateObjectId(id, 'Optimization ID');

            if (helpful === undefined) {
                res.status(400).json({
                    success: false,
                    message: 'Feedback helpful status is required',
                });
                return;
            }

            if (rating !== undefined && (rating < 1 || rating > 5)) {
                res.status(400).json({
                    success: false,
                    message: 'Rating must be between 1 and 5',
                });
                return;
            }

            await OptimizationService.provideFeedback(id, userId, {
                helpful,
                rating,
                comment,
            });

            ControllerHelper.logRequestSuccess('provideFeedback', req, startTime, {
                optimizationId: id,
                helpful,
                rating
            });

            ControllerHelper.logBusinessEvent(
                'optimization_feedback_submitted',
                'optimization_operations',
                userId,
                Date.now() - startTime,
                {
                    optimizationId: id,
                    helpful,
                    rating,
                    comment,
                    hasComment: !!comment
                }
            );

            res.json({
                success: true,
                message: 'Feedback submitted successfully',
            });
        } catch (error: any) {
            if (error.message === 'Optimization not found') {
                res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
                return;
            }
            ControllerHelper.handleError('provideFeedback', error, req, res, startTime);
            next(error);
        }
    }

    static async analyzeOpportunities(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('analyzeOpportunities', req);

        try {
            const opportunities = await OptimizationService.analyzeOptimizationOpportunities(userId);

            ControllerHelper.logRequestSuccess('analyzeOpportunities', req, startTime, {
                opportunitiesCount: opportunities.opportunities?.length || 0,
                totalPotentialSavings: opportunities.totalPotentialSavings
            });

            ControllerHelper.logBusinessEvent(
                'optimization_opportunities_analyzed',
                'optimization_operations',
                userId,
                Date.now() - startTime,
                {
                    opportunitiesCount: opportunities.opportunities?.length || 0,
                    hasOpportunities: !!(opportunities.opportunities && opportunities.opportunities.length > 0),
                    totalPotentialSavings: opportunities.totalPotentialSavings
                }
            );

            res.json({
                success: true,
                data: opportunities,
            });
        } catch (error: any) {
            ControllerHelper.handleError('analyzeOpportunities', error, req, res, startTime);
            next(error);
        }
    }

    static async getPromptsForBulkOptimization(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { service, minCalls, timeframe } = req.query;
        ControllerHelper.logRequestStart('getPromptsForBulkOptimization', req);

        try {
            const prompts = await OptimizationService.getPromptsForBulkOptimization(userId, {
                service: service as string,
                minCalls: minCalls ? parseInt(minCalls as string) : undefined,
                timeframe: timeframe as string,
            });

            ControllerHelper.logRequestSuccess('getPromptsForBulkOptimization', req, startTime, {
                service,
                promptsCount: prompts.length
            });

            ControllerHelper.logBusinessEvent(
                'prompts_for_bulk_optimization_retrieved',
                'optimization_operations',
                userId,
                Date.now() - startTime,
                {
                    service,
                    minCalls,
                    timeframe,
                    promptsCount: prompts.length,
                    hasPrompts: !!prompts && prompts.length > 0
                }
            );

            res.json({
                success: true,
                data: prompts,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getPromptsForBulkOptimization', error, req, res, startTime);
            next(error);
        }
    }

    static async bulkOptimize(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { promptIds, cortexEnabled, cortexConfig } = req.body;
        ControllerHelper.logRequestStart('bulkOptimize', req);

        try {
            if (!Array.isArray(promptIds) || promptIds.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Array of prompt IDs is required',
                });
                return;
            }

            if (promptIds.length > 10) {
                res.status(400).json({
                    success: false,
                    message: 'Maximum 10 prompts can be optimized at once',
                });
                return;
            }

            const result = await OptimizationService.generateBulkOptimizations(userId, promptIds, {
                cortexEnabled,
                cortexConfig
            });

            ControllerHelper.logRequestSuccess('bulkOptimize', req, startTime, {
                promptIdsCount: promptIds.length,
                successful: result.successful,
                total: result.total
            });

            ControllerHelper.logBusinessEvent(
                'bulk_optimization_completed',
                'optimization_operations',
                userId,
                Date.now() - startTime,
                {
                    promptIdsCount: promptIds.length,
                    successful: result.successful,
                    total: result.total,
                    hasResult: !!result
                }
            );

            res.json({
                success: true,
                message: `Successfully optimized ${result.successful} out of ${result.total} prompts`,
                data: result,
            });
        } catch (error: any) {
            ControllerHelper.handleError('bulkOptimize', error, req, res, startTime);
            next(error);
        }
    }

    static async getOptimizationSummary(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const timeframe = (req.query.timeframe as string) || '30d';
        ControllerHelper.logRequestStart('getOptimizationSummary', req);

        try {
            let startDate: Date;
            const endDate = new Date();

            switch (timeframe) {
                case '7d':
                    startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                    break;
                case 'all':
                    startDate = new Date(0);
                    break;
                default:
                    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            }

            // Use unified aggregation pipeline for all summary data
            const [summaryResult] = await Optimization.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $facet: {
                        summary: [
                            {
                                $group: {
                                    _id: null,
                                    total: { $sum: 1 },
                                    totalSaved: { $sum: '$costSaved' },
                                    totalTokensSaved: { $sum: '$tokensSaved' },
                                    avgImprovement: { $avg: '$improvementPercentage' },
                                    applied: {
                                        $sum: { $cond: [{ $eq: ['$applied', true] }, 1, 0] }
                                    }
                                }
                            }
                        ],
                        categories: [
                            {
                                $group: {
                                    _id: '$category',
                                    count: { $sum: 1 },
                                    avgSavings: { $avg: '$costSaved' }
                                }
                            }
                        ],
                        topOptimizations: [
                            { $sort: { costSaved: -1 } },
                            { $limit: 5 },
                            {
                                $project: {
                                    userQuery: 1,
                                    generatedAnswer: 1,
                                    costSaved: 1,
                                    tokensSaved: 1,
                                    improvementPercentage: 1,
                                    category: 1
                                }
                            }
                        ]
                    }
                }
            ]);

            const summaryStats = summaryResult.summary[0];
            const categoryStats = summaryResult.categories || [];
            const topOptimizations = summaryResult.topOptimizations || [];

            if (!summaryStats) {
                ControllerHelper.logRequestSuccess('getOptimizationSummary', req, startTime, {
                    timeframe,
                    total: 0
                });
                res.json({
                    success: true,
                    data: {
                        total: 0,
                        totalSaved: 0,
                        totalTokensSaved: 0,
                        avgImprovement: 0,
                        applied: 0,
                        applicationRate: 0,
                        byCategory: {},
                        topOptimizations: [],
                    },
                });
                return;
            }

            const summary = {
                total: summaryStats.total,
                totalSaved: summaryStats.totalSaved,
                totalTokensSaved: summaryStats.totalTokensSaved,
                avgImprovement: summaryStats.avgImprovement || 0,
                // No longer tracking application rate
                byCategory: categoryStats.reduce((acc: any, cat: any) => {
                    acc[cat._id] = {
                        count: cat.count,
                        avgSavings: cat.avgSavings
                    };
                    return acc;
                }, {}),
                topOptimizations,
            };

            ControllerHelper.logRequestSuccess('getOptimizationSummary', req, startTime, {
                timeframe,
                total: summary.total
            });

            res.json({
                success: true,
                data: summary,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getOptimizationSummary', error, req, res, startTime);
            next(error);
        }
    }

    static async createBatchOptimization(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { requests } = req.body;
        ControllerHelper.logRequestStart('createBatchOptimization', req);

        try {
            if (!Array.isArray(requests) || requests.length < 2) {
                res.status(400).json({
                    success: false,
                    message: 'At least 2 requests are required for batch optimization',
                });
                return;
            }

            if (requests.length > 10) {
                res.status(400).json({
                    success: false,
                    message: 'Maximum 10 requests can be optimized in a batch',
                });
                return;
            }

            const optimizations = await OptimizationService.createBatchOptimization({
                userId,
                requests,
                enableFusion: req.body.enableFusion !== false,
            });

            ControllerHelper.logRequestSuccess('createBatchOptimization', req, startTime, {
                optimizationsCount: optimizations.length
            });

            res.status(201).json({
                success: true,
                message: `Successfully created ${optimizations.length} batch optimizations`,
                data: optimizations.map((opt: any) => ({
                    id: opt._id,
                    improvementPercentage: opt.improvementPercentage,
                    costSaved: opt.costSaved,
                    tokensSaved: opt.tokensSaved,
                    fusionStrategy: opt.metadata?.fusionStrategy,
                })),
            });
        } catch (error: any) {
            ControllerHelper.handleError('createBatchOptimization', error, req, res, startTime);
            next(error);
        }
    }

    static async optimizeConversation(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { messages, model, service } = req.body;
        ControllerHelper.logRequestStart('optimizeConversation', req);

        try {
            if (!Array.isArray(messages) || messages.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Array of conversation messages is required',
                });
                return;
            }

            // Validate message format
            const isValidMessages = messages.every((msg: any) =>
                msg.role && ['user', 'assistant', 'system'].includes(msg.role) &&
                typeof msg.content === 'string'
            );

            if (!isValidMessages) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid message format. Each message must have role and content',
                });
                return;
            }

            const optimization = await OptimizationService.createOptimization({
                userId,
                prompt: messages.map((m: any) => `${m.role}: ${m.content}`).join('\n'),
                service,
                model,
                conversationHistory: messages,
                options: {
                    enableCompression: req.body.enableCompression !== false,
                    enableContextTrimming: req.body.enableContextTrimming !== false,
                }
            });

            ControllerHelper.logRequestSuccess('optimizeConversation', req, startTime, {
                optimizationId: optimization._id,
                originalMessages: messages.length
            });

            res.status(201).json({
                success: true,
                message: 'Conversation optimization created successfully',
                data: {
                    id: optimization._id,
                    originalMessages: messages.length,
                    trimmedMessages: optimization.metadata?.contextTrimDetails?.trimmedMessages,
                    improvementPercentage: optimization.improvementPercentage,
                    costSaved: optimization.costSaved,
                    tokensSaved: optimization.tokensSaved,
                    optimizationType: optimization.metadata?.optimizationType,
                    trimmingTechnique: optimization.metadata?.contextTrimDetails?.technique,
                },
            });
        } catch (error: any) {
            ControllerHelper.handleError('optimizeConversation', error, req, res, startTime);
            next(error);
        }
    }

    static async getOptimizationPreview(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { prompt, model, service, conversationHistory, enableCompression, enableContextTrimming, enableRequestFusion } = req.body;
        ControllerHelper.logRequestStart('getOptimizationPreview', req);

        try {
            if (!prompt || !model || !service) {
                res.status(400).json({
                    success: false,
                    message: 'Prompt, model, and service are required',
                });
                return;
            }

            const optimization = await OptimizationService.createOptimization({
                userId,
                prompt,
                model,
                service,
                conversationHistory,
                options: {
                    enableCompression: enableCompression !== false,
                    enableContextTrimming: enableContextTrimming !== false,
                    enableRequestFusion: enableRequestFusion !== false,
                }
            });

            ControllerHelper.logRequestSuccess('getOptimizationPreview', req, startTime, {
                improvementPercentage: optimization.improvementPercentage
            });

            res.json({
                success: true,
                data: {
                    suggestions: optimization.suggestions,
                    totalSavings: optimization.costSaved,
                    techniques: optimization.optimizationTechniques,
                    originalTokens: optimization.originalTokens,
                    optimizedTokens: optimization.optimizedTokens,
                    improvementPercentage: optimization.improvementPercentage,
                },
            });
        } catch (error: any) {
            ControllerHelper.handleError('getOptimizationPreview', error, req, res, startTime);
            next(error);
        }
    }

    static async getOptimizationConfig(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getOptimizationConfig', _req);

        try {
            // For now, return default configuration
            // In a real implementation, this would be stored per user in the database
            const defaultConfig = {
                enabledTechniques: [
                    'prompt_compression',
                    'context_trimming',
                    'request_fusion'
                ],
                defaultSettings: {
                    promptCompression: {
                        enabled: true,
                        minCompressionRatio: 0.2,
                        jsonCompressionThreshold: 1000
                    },
                    contextTrimming: {
                        enabled: true,
                        maxContextLength: 4000,
                        preserveRecentMessages: 3
                    },
                    requestFusion: {
                        enabled: true,
                        maxFusionBatch: 5,
                        fusionWaitTime: 1000
                    }
                },
                thresholds: {
                    highCostPerRequest: 0.01,
                    highTokenUsage: 2000,
                    frequencyThreshold: 5,
                    batchingThreshold: 3,
                    modelDowngradeConfidence: 0.8
                }
            };

            ControllerHelper.logRequestSuccess('getOptimizationConfig', _req, startTime);

            res.json({
                success: true,
                data: defaultConfig,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getOptimizationConfig', error, _req, res, startTime);
            next(error);
        }
    }

    static async updateOptimizationConfig(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const config = req.body;
        ControllerHelper.logRequestStart('updateOptimizationConfig', req);

        try {
            // For now, just acknowledge the update
            // In a real implementation, this would update the user's configuration in the database

            ControllerHelper.logRequestSuccess('updateOptimizationConfig', req, startTime, {
                configKeys: Object.keys(config || {})
            });

            res.json({
                success: true,
                message: 'Optimization configuration updated successfully',
                data: config,
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateOptimizationConfig', error, req, res, startTime);
            next(error);
        }
    }

    static async getOptimizationTemplates(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getOptimizationTemplates', req);

        try {
            const { category } = req.query;

            // Get real optimization templates from database
            const templates = await OptimizationService.getOptimizationTemplates(category as string | undefined);

            ControllerHelper.logRequestSuccess('getOptimizationTemplates', req, startTime, {
                category,
                templatesCount: templates.length
            });

            res.json({
                success: true,
                data: templates,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getOptimizationTemplates', error, req, res, startTime);
            next(error);
        }
    }

    static async getOptimizationHistory(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { promptHash } = req.params;
        ControllerHelper.logRequestStart('getOptimizationHistory', req);

        try {
            // Get real optimization history from database
            const history = await OptimizationService.getOptimizationHistory(promptHash, userId);

            ControllerHelper.logRequestSuccess('getOptimizationHistory', req, startTime, {
                promptHash,
                historyCount: history.history?.length || 0,
                currentVersion: history.currentVersion
            });

            ControllerHelper.logBusinessEvent(
                'optimization_history_retrieved',
                'optimization_operations',
                userId,
                Date.now() - startTime,
                {
                    promptHash,
                    hasPromptHash: !!promptHash,
                    historyCount: history.history?.length || 0,
                    hasHistory: !!(history.history && history.history.length > 0),
                    currentVersion: history.currentVersion
                }
            );

            res.json({
                success: true,
                data: history,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getOptimizationHistory', error, req, res, startTime);
            next(error);
        }
    }

    static async revertOptimization(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { id } = req.params;
        const { version } = req.body;
        ControllerHelper.logRequestStart('revertOptimization', req);

        try {
            ServiceHelper.validateObjectId(id, 'Optimization ID');

            // Revert optimization to previous version
            await OptimizationService.revertOptimization(id, userId, version);

            ControllerHelper.logRequestSuccess('revertOptimization', req, startTime, {
                optimizationId: id,
                version
            });

            res.json({
                success: true,
                message: 'Optimization reverted successfully',
            });
        } catch (error: any) {
            ControllerHelper.handleError('revertOptimization', error, req, res, startTime);
            next(error);
        }
    }

    /**
     * Get Cortex cache statistics
     */
    static async getCortexCacheStats(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getCortexCacheStats', _req);

        try {
            const { CortexCacheService } = await import('../services/cortexCache.service');
            const stats = CortexCacheService.getCacheStats();
            
            ControllerHelper.logRequestSuccess('getCortexCacheStats', _req, startTime, {
                hitRate: stats.hitRate
            });
            
            res.status(200).json({
                success: true,
                data: {
                    cache: stats,
                    performance: {
                        hitRatePercentage: stats.hitRate ? (stats.hitRate * 100).toFixed(1) : '0.0',
                        utilizationPercentage: ((stats.size / stats.maxEntries) * 100).toFixed(1),
                        estimatedMemorySavedMB: stats.size > 0 ? ((stats.size * 2.5) / 1000).toFixed(2) : '0.00' // Rough estimate
                    }
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getCortexCacheStats', error, _req, res, startTime);
            next(error);
        }
    }

    /**
     * Clear Cortex cache (admin endpoint)
     */
    static async clearCortexCache(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('clearCortexCache', _req);

        try {
            const { CortexCacheService } = await import('../services/cortexCache.service');
            CortexCacheService.clearCache();
            
            ControllerHelper.logRequestSuccess('clearCortexCache', _req, startTime);
            
            res.status(200).json({
                success: true,
                message: 'Cortex cache cleared successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('clearCortexCache', error, _req, res, startTime);
            next(error);
        }
    }








}