import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { OptimizationService } from '../services/optimization.service';
import { optimizationRequestSchema, paginationSchema } from '../utils/validators';
import { loggingService } from '../services/logging.service';

/**
 * Model mapping from short names to full AWS Bedrock model IDs
 */
const mapToFullModelId = (shortName?: string): string | undefined => {
    if (!shortName) return undefined;
    
    const modelMap: Record<string, string> = {
        // Claude 3.5 models (upgraded)
        'claude-3-haiku': 'anthropic.claude-3-5-haiku-20241022-v1:0',
        'claude-3-5-haiku': 'anthropic.claude-3-5-haiku-20241022-v1:0',
        'claude-3-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'claude-3-5-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        
        // Claude 4 models
        'claude-4': 'anthropic.claude-opus-4-1-20250805-v1:0',
        'claude-opus-4': 'anthropic.claude-opus-4-1-20250805-v1:0',
        
        // Nova models
        'nova-pro': 'amazon.nova-pro-v1:0',
        'nova-lite': 'amazon.nova-lite-v1:0',
        'nova-micro': 'amazon.nova-micro-v1:0',
        
        // Full model IDs (pass through)
        'anthropic.claude-3-5-haiku-20241022-v1:0': 'anthropic.claude-3-5-haiku-20241022-v1:0',
        'anthropic.claude-3-5-sonnet-20240620-v1:0': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'anthropic.claude-opus-4-1-20250805-v1:0': 'anthropic.claude-opus-4-1-20250805-v1:0',
        'amazon.nova-pro-v1:0': 'amazon.nova-pro-v1:0'
    };
    
    return modelMap[shortName] || shortName;
};
import { Optimization } from '../models';


export class OptimizationController {
    static async createOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;

        try {
            loggingService.info('Optimization creation initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

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

            const optimization = await OptimizationService.createOptimization({
                userId,
                prompt: validatedData.prompt,
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

            const duration = Date.now() - startTime;

            loggingService.info('Optimization created successfully', {
                userId,
                duration,
                optimizationId: optimization._id,
                hasUserQuery: !!optimization.userQuery,
                hasGeneratedAnswer: !!optimization.generatedAnswer,
                improvementPercentage: optimization.improvementPercentage,
                costSaved: optimization.costSaved,
                tokensSaved: optimization.tokensSaved,
                hasSuggestions: !!optimization.suggestions,
                hasMetadata: !!optimization.metadata,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'optimization_created',
                category: 'optimization_operations',
                value: duration,
                metadata: {
                    userId,
                    optimizationId: optimization._id,
                    hasUserQuery: !!optimization.userQuery,
                    hasGeneratedAnswer: !!optimization.generatedAnswer,
                    improvementPercentage: optimization.improvementPercentage,
                    costSaved: optimization.costSaved,
                    tokensSaved: optimization.tokensSaved,
                    hasSuggestions: !!optimization.suggestions,
                    hasMetadata: !!optimization.metadata
                }
            });

            res.status(201).json({
                success: true,
                message: 'Optimization created successfully',
                data: {
                    id: optimization._id,
                    userQuery: optimization.userQuery,
                    generatedAnswer: optimization.generatedAnswer,
                    improvementPercentage: optimization.improvementPercentage,
                    costSaved: optimization.costSaved,
                    tokensSaved: optimization.tokensSaved,
                    suggestions: optimization.suggestions,
                    metadata: optimization.metadata,
                    
                    // 🚀 CORTEX METADATA in response
                    cortexEnabled: optimization.metadata?.cortexEnabled || false,
                    cortexProcessingTime: optimization.metadata?.cortexProcessingTime,
                    cortexSemanticIntegrity: optimization.metadata?.cortexSemanticIntegrity,
                    cortexTokenReduction: optimization.metadata?.cortexTokenReduction
                },
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Optimization creation failed', {
                userId,
                hasUserId: !!userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    static async getOptimizations(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;

        try {
            loggingService.info('Optimizations retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('Optimizations retrieved successfully', {
                userId,
                duration,
                page,
                limit,
                sort,
                order,
                optimizationsCount: result.data.length,
                hasOptimizations: !!result.data && result.data.length > 0,
                hasPagination: !!result.pagination,
                totalPages: result.pagination?.pages,
                totalCount: result.pagination?.total,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'optimizations_retrieved',
                category: 'optimization_operations',
                value: duration,
                metadata: {
                    userId,
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
            });

            res.json({
                success: true,
                data: result.data,
                pagination: result.pagination,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Optimizations retrieval failed', {
                userId,
                hasUserId: !!userId,
                page: req.query.page,
                limit: req.query.limit,
                sort: req.query.sort,
                order: req.query.order,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    static async getOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { id } = req.params;

        try {
            loggingService.info('Individual optimization retrieval initiated', {
                userId,
                hasUserId: !!userId,
                optimizationId: id,
                hasOptimizationId: !!id,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.info('Individual optimization retrieval processing started', {
                userId,
                optimizationId: id,
                requestId: req.headers['x-request-id'] as string
            });

            const result = await OptimizationService.getOptimizations(
                { userId },
                { page: 1, limit: 1 }
            );

            const optimization = result.data.find((o: any) => o._id.toString() === id);

            if (!optimization) {
                const duration = Date.now() - startTime;

                loggingService.warn('Individual optimization retrieval failed - optimization not found', {
                    userId,
                    optimizationId: id,
                    duration,
                    hasResult: !!result,
                    resultDataCount: result.data.length,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Individual optimization retrieved successfully', {
                userId,
                optimizationId: id,
                duration,
                hasOptimization: !!optimization,
                hasUserQuery: !!(optimization as any)?.userQuery,
                hasGeneratedAnswer: !!(optimization as any)?.generatedAnswer,
                improvementPercentage: (optimization as any)?.improvementPercentage,
                costSaved: (optimization as any)?.costSaved,
                tokensSaved: (optimization as any)?.tokensSaved,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'individual_optimization_retrieved',
                category: 'optimization_operations',
                value: duration,
                metadata: {
                    userId,
                    optimizationId: id,
                    hasOptimization: !!optimization,
                    hasUserQuery: !!(optimization as any)?.userQuery,
                    hasGeneratedAnswer: !!(optimization as any)?.generatedAnswer,
                    improvementPercentage: (optimization as any)?.improvementPercentage,
                    costSaved: (optimization as any)?.costSaved,
                    tokensSaved: (optimization as any)?.tokensSaved
                }
            });

            res.json({
                success: true,
                data: optimization,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Individual optimization retrieval failed', {
                userId,
                hasUserId: !!userId,
                optimizationId: id,
                hasOptimizationId: !!id,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    static async applyOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { id } = req.params;

        try {
            loggingService.info('Optimization application initiated', {
                userId,
                hasUserId: !!userId,
                optimizationId: id,
                hasOptimizationId: !!id,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.info('Optimization application processing started', {
                userId,
                optimizationId: id,
                requestId: req.headers['x-request-id'] as string
            });

            await OptimizationService.applyOptimization(id, userId);

            const duration = Date.now() - startTime;

            loggingService.info('Optimization applied successfully', {
                userId,
                optimizationId: id,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'optimization_applied',
                category: 'optimization_operations',
                value: duration,
                metadata: {
                    userId,
                    optimizationId: id
                }
            });

            res.json({
                success: true,
                message: 'Optimization applied successfully',
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Optimization application failed', {
                userId,
                hasUserId: !!userId,
                optimizationId: id,
                hasOptimizationId: !!id,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            if (error.message === 'Optimization not found') {
                res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
                return;
            }

            next(error);
        }
    }

    static async provideFeedback(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { id } = req.params;
        const { helpful, rating, comment } = req.body;

        try {
            loggingService.info('Optimization feedback submission initiated', {
                userId,
                hasUserId: !!userId,
                optimizationId: id,
                hasOptimizationId: !!id,
                helpful,
                hasHelpful: helpful !== undefined,
                rating,
                hasRating: rating !== undefined,
                comment,
                hasComment: !!comment,
                requestId: req.headers['x-request-id'] as string
            });

            if (helpful === undefined) {
                loggingService.warn('Optimization feedback submission failed - helpful status is required', {
                    userId,
                    optimizationId: id,
                    rating,
                    hasRating: rating !== undefined,
                    comment,
                    hasComment: !!comment,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Feedback helpful status is required',
                });
                return;
            }

            if (rating !== undefined && (rating < 1 || rating > 5)) {
                loggingService.warn('Optimization feedback submission failed - invalid rating', {
                    userId,
                    optimizationId: id,
                    helpful,
                    rating,
                    comment,
                    hasComment: !!comment,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Rating must be between 1 and 5',
                });
                return;
            }

            loggingService.info('Optimization feedback submission processing started', {
                userId,
                optimizationId: id,
                helpful,
                rating,
                comment,
                hasComment: !!comment,
                requestId: req.headers['x-request-id'] as string
            });

            await OptimizationService.provideFeedback(id, userId, {
                helpful,
                rating,
                comment,
            });

            const duration = Date.now() - startTime;

            loggingService.info('Optimization feedback submitted successfully', {
                userId,
                optimizationId: id,
                duration,
                helpful,
                rating,
                comment,
                hasComment: !!comment,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'optimization_feedback_submitted',
                category: 'optimization_operations',
                value: duration,
                metadata: {
                    userId,
                    optimizationId: id,
                    helpful,
                    rating,
                    comment,
                    hasComment: !!comment
                }
            });

            res.json({
                success: true,
                message: 'Feedback submitted successfully',
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Optimization feedback submission failed', {
                userId,
                hasUserId: !!userId,
                optimizationId: id,
                hasOptimizationId: !!id,
                helpful,
                hasHelpful: helpful !== undefined,
                rating,
                hasRating: rating !== undefined,
                comment,
                hasComment: !!comment,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            if (error.message === 'Optimization not found') {
                res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
                return;
            }

            next(error);
        }
    }

    static async analyzeOpportunities(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;

        try {
            loggingService.info('Optimization opportunities analysis initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.info('Optimization opportunities analysis processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            const opportunities = await OptimizationService.analyzeOptimizationOpportunities(userId);

            const duration = Date.now() - startTime;

            loggingService.info('Optimization opportunities analysis completed successfully', {
                userId,
                duration,
                opportunitiesCount: opportunities.opportunities?.length || 0,
                hasOpportunities: !!(opportunities.opportunities && opportunities.opportunities.length > 0),
                totalPotentialSavings: opportunities.totalPotentialSavings,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'optimization_opportunities_analyzed',
                category: 'optimization_operations',
                value: duration,
                metadata: {
                    userId,
                    opportunitiesCount: opportunities.opportunities?.length || 0,
                    hasOpportunities: !!(opportunities.opportunities && opportunities.opportunities.length > 0),
                    totalPotentialSavings: opportunities.totalPotentialSavings
                }
            });

            res.json({
                success: true,
                data: opportunities,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Optimization opportunities analysis failed', {
                userId,
                hasUserId: !!userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    static async getPromptsForBulkOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { service, minCalls, timeframe } = req.query;

        try {
            loggingService.info('Prompts for bulk optimization retrieval initiated', {
                userId,
                hasUserId: !!userId,
                service,
                hasService: !!service,
                minCalls,
                hasMinCalls: !!minCalls,
                timeframe,
                hasTimeframe: !!timeframe,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.info('Prompts for bulk optimization retrieval processing started', {
                userId,
                service,
                minCalls,
                timeframe,
                requestId: req.headers['x-request-id'] as string
            });

            const prompts = await OptimizationService.getPromptsForBulkOptimization(userId, {
                service: service as string,
                minCalls: minCalls ? parseInt(minCalls as string) : undefined,
                timeframe: timeframe as string,
            });

            const duration = Date.now() - startTime;

            loggingService.info('Prompts for bulk optimization retrieved successfully', {
                userId,
                duration,
                service,
                minCalls,
                timeframe,
                promptsCount: prompts.length,
                hasPrompts: !!prompts && prompts.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'prompts_for_bulk_optimization_retrieved',
                category: 'optimization_operations',
                value: duration,
                metadata: {
                    userId,
                    service,
                    minCalls,
                    timeframe,
                    promptsCount: prompts.length,
                    hasPrompts: !!prompts && prompts.length > 0
                }
            });

            res.json({
                success: true,
                data: prompts,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Prompts for bulk optimization retrieval failed', {
                userId,
                hasUserId: !!userId,
                service,
                hasService: !!service,
                minCalls,
                hasMinCalls: !!minCalls,
                timeframe,
                hasTimeframe: !!timeframe,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    static async bulkOptimize(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { promptIds, cortexEnabled, cortexConfig } = req.body;

        try {
            loggingService.info('Bulk optimization initiated', {
                userId,
                hasUserId: !!userId,
                hasPromptIds: !!promptIds,
                promptIdsCount: Array.isArray(promptIds) ? promptIds.length : 0,
                requestId: req.headers['x-request-id'] as string
            });

            if (!Array.isArray(promptIds) || promptIds.length === 0) {
                loggingService.warn('Bulk optimization failed - array of prompt IDs is required', {
                    userId,
                    hasPromptIds: !!promptIds,
                    promptIdsCount: Array.isArray(promptIds) ? promptIds.length : 0,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Array of prompt IDs is required',
                });
                return;
            }

            if (promptIds.length > 10) {
                loggingService.warn('Bulk optimization failed - maximum 10 prompts allowed', {
                    userId,
                    promptIdsCount: promptIds.length,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Maximum 10 prompts can be optimized at once',
                });
                return;
            }

            loggingService.info('Bulk optimization processing started', {
                userId,
                promptIdsCount: promptIds.length,
                requestId: req.headers['x-request-id'] as string
            });

            const result = await OptimizationService.generateBulkOptimizations(userId, promptIds, {
                cortexEnabled,
                cortexConfig
            });

            const duration = Date.now() - startTime;

            loggingService.info('Bulk optimization completed successfully', {
                userId,
                duration,
                promptIdsCount: promptIds.length,
                successful: result.successful,
                total: result.total,
                hasResult: !!result,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'bulk_optimization_completed',
                category: 'optimization_operations',
                value: duration,
                metadata: {
                    userId,
                    promptIdsCount: promptIds.length,
                    successful: result.successful,
                    total: result.total,
                    hasResult: !!result
                }
            });

            res.json({
                success: true,
                message: `Successfully optimized ${result.successful} out of ${result.total} prompts`,
                data: result,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Bulk optimization failed', {
                userId,
                hasUserId: !!userId,
                hasPromptIds: !!promptIds,
                promptIdsCount: Array.isArray(promptIds) ? promptIds.length : 0,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    static async getOptimizationSummary(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const timeframe = (req.query.timeframe as string) || '30d';

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

            res.json({
                success: true,
                data: summary,
            });
        } catch (error: any) {
            loggingService.error('Get optimization summary error:', error);
            next(error);
        }
    }

    static async createBatchOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { requests } = req.body;

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
            loggingService.error('Create batch optimization error:', error);
            next(error);
        }
    }

    static async optimizeConversation(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { messages, model, service } = req.body;

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
            loggingService.error('Optimize conversation error:', error);
            next(error);
        }
    }

    static async getOptimizationPreview(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { prompt, model, service, conversationHistory, enableCompression, enableContextTrimming, enableRequestFusion } = req.body;

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
            loggingService.error('Get optimization preview error:', error);
            next(error);
        }
    }

    static async getOptimizationConfig(res: Response, next: NextFunction): Promise<void> {
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

            res.json({
                success: true,
                data: defaultConfig,
            });
        } catch (error: any) {
            loggingService.error('Get optimization config error:', error);
            next(error);
        }
    }

    static async updateOptimizationConfig(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const config = req.body;

            // For now, just acknowledge the update
            // In a real implementation, this would update the user's configuration in the database
            loggingService.info('Optimization config updated for user:', { userId, config });

            res.json({
                success: true,
                message: 'Optimization configuration updated successfully',
                data: config,
            });
        } catch (error: any) {
            loggingService.error('Update optimization config error:', error);
            next(error);
        }
    }

    static async getOptimizationTemplates(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { category } = req.query;

            // Get real optimization templates from database
            const templates = await OptimizationService.getOptimizationTemplates(category);

            res.json({
                success: true,
                data: templates,
            });
        } catch (error: any) {
            loggingService.error('Get optimization templates error:', error);
            next(error);
        }
    }

    static async getOptimizationHistory(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        
        try {
            const { promptHash } = req.params;
            const userId = req.user!.id;

            // Get real optimization history from database
            const history = await OptimizationService.getOptimizationHistory(promptHash, userId);

            const duration = Date.now() - startTime;

            loggingService.info('Optimization history retrieved successfully', {
                userId,
                promptHash,
                hasPromptHash: !!promptHash,
                duration,
                historyCount: history.history?.length || 0,
                hasHistory: !!(history.history && history.history.length > 0),
                currentVersion: history.currentVersion,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'optimization_history_retrieved',
                category: 'optimization_operations',
                value: duration,
                metadata: {
                    userId,
                    promptHash,
                    hasPromptHash: !!promptHash,
                    historyCount: history.history?.length || 0,
                    hasHistory: !!(history.history && history.history.length > 0),
                    currentVersion: history.currentVersion
                }
            });

            res.json({
                success: true,
                data: history,
            });
        } catch (error: any) {
            loggingService.error('Get optimization history error:', error);
            next(error);
        }
    }

    static async revertOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const userId = req.user!.id;
            const { version } = req.body;

            // Revert optimization to previous version
            await OptimizationService.revertOptimization(id, userId, version);

            res.json({
                success: true,
                message: 'Optimization reverted successfully',
            });
        } catch (error: any) {
            loggingService.error('Revert optimization error:', error);
            next(error);
        }
    }

    /**
     * Get Cortex cache statistics
     */
    static async getCortexCacheStats(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { CortexCacheService } = await import('../services/cortexCache.service');
            const stats = CortexCacheService.getCacheStats();
            
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
            loggingService.error('Failed to get cache stats', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    /**
     * Clear Cortex cache (admin endpoint)
     */
    static async clearCortexCache(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { CortexCacheService } = await import('../services/cortexCache.service');
            CortexCacheService.clearCache();
            
            res.status(200).json({
                success: true,
                message: 'Cortex cache cleared successfully'
            });
        } catch (error: any) {
            loggingService.error('Failed to clear cache', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }








}