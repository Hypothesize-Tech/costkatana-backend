import { Request } from 'express';
import { loggingService } from '../../logging.service';
import { BudgetService } from '../../budget.service';
import { costSimulatorService } from '../../costSimulator.service';
import { costStreamingService } from '../../costStreaming.service';

/**
 * BudgetEnforcementService - Handles budget constraint checking and enforcement
 * Provides pre-flight budget checks with cost simulation and reservation
 */
export class BudgetEnforcementService {
    /**
     * Check budget constraints before making request with pre-flight estimation
     */
    static async checkBudgetConstraints(req: Request): Promise<{ 
        allowed: boolean; 
        message?: string; 
        reservationId?: string;
        simulation?: any;
        remainingBudget?: number;
        reason?: string;
        recommendedAction?: string;
    }> {
        const context = req.gatewayContext!;
        
        try {
            if (!context.userId) {
                return { allowed: true };
            }

            // Step 1: Cost Simulation (Layer 6)
            const prompt = BudgetEnforcementService.extractPromptFromRequest(req.body);
            const model = req.body?.model || context.modelOverride || 'gpt-3.5-turbo';
            const provider = context.provider || 'openai';
            
            let simulation;
            try {
                simulation = await costSimulatorService.simulateRequestCost(
                    prompt || '',
                    model,
                    provider,
                    context.userId,
                    context.workspaceId,
                    {
                        includeAlternatives: true,
                        maxOutputTokens: req.body?.max_tokens || 1000
                    }
                );

                // Log simulation for tracking
                loggingService.debug('Cost simulation completed', {
                    requestId: simulation.requestId,
                    estimatedCost: simulation.originalRequest.estimatedCost,
                    alternatives: simulation.alternatives.length
                });
            } catch (simError) {
                loggingService.warn('Cost simulation failed, using fallback estimation', {
                    error: simError instanceof Error ? simError.message : String(simError)
                });
                
                // Fallback to basic estimation
                const estimatedTokens = prompt ? Math.ceil(prompt.length / 4) : 100;
                simulation = {
                    originalRequest: {
                        estimatedCost: estimatedTokens * 0.00001, // Rough estimate
                        estimatedTokens: { total: estimatedTokens * 1.5 }
                    }
                };
            }

            // Step 2: Pre-flight Budget Enforcement (Layer 4)
            if (context.budgetId) {
                const estimatedCost = simulation.originalRequest.estimatedCost;
                
                // Use enhanced pre-flight check
                const budgetCheck = await BudgetService.preFlightBudgetCheck(
                    context.userId,
                    estimatedCost,
                    context.budgetId,
                    context.workspaceId,
                    {
                        enforceHardLimits: true,
                        allowDowngrade: true,
                        planTier: (req as any).user?.planTier || 'plus'
                    }
                );

                if (!budgetCheck.allowed) {
                    // Emit budget warning via streaming
                    costStreamingService.emitCostEvent({
                        eventType: 'budget_warning',
                        timestamp: new Date(),
                        userId: context.userId,
                        workspaceId: context.workspaceId,
                        data: {
                            estimatedCost,
                            budgetRemaining: budgetCheck.remainingBudget,
                            metadata: {
                                reason: budgetCheck.reason,
                                recommendedAction: budgetCheck.recommendedAction
                            }
                        }
                    });

                    return {
                        allowed: false,
                        message: budgetCheck.reason || 'Budget limit exceeded',
                        simulation,
                        remainingBudget: budgetCheck.remainingBudget,
                        reason: budgetCheck.reason,
                        recommendedAction: budgetCheck.recommendedAction
                    };
                }

                loggingService.info('Pre-flight budget check passed', {
                    userId: context.userId,
                    estimatedCost,
                    remainingBudget: budgetCheck.remainingBudget,
                    reservationId: budgetCheck.reservationId
                });

                return { 
                    allowed: true, 
                    reservationId: budgetCheck.reservationId,
                    simulation,
                    remainingBudget: budgetCheck.remainingBudget
                };
            }

            return { allowed: true, simulation };
        } catch (error: any) {
            loggingService.error('Budget check error', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                requestId: req.headers['x-request-id'] as string
            });
            return { allowed: true }; // Fail-open to prevent blocking
        }
    }

    /**
     * Validate budget limit against estimated cost
     */
    static async validateBudgetLimit(
        userId: string,
        budgetId: string,
        estimatedCost: number,
        workspaceId?: string
    ): Promise<{
        isValid: boolean;
        remainingBudget: number;
        message?: string;
    }> {
        try {
            const budgetCheck = await BudgetService.preFlightBudgetCheck(
                userId,
                estimatedCost,
                budgetId,
                workspaceId,
                {
                    enforceHardLimits: true,
                    allowDowngrade: false,
                    planTier: 'plus'
                }
            );

            return {
                isValid: budgetCheck.allowed,
                remainingBudget: budgetCheck.remainingBudget || 0,
                message: budgetCheck.reason
            };
        } catch (error: any) {
            loggingService.error('Budget limit validation error', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                userId,
                budgetId
            });
            return {
                isValid: true, // Fail-open
                remainingBudget: 0,
                message: 'Budget validation failed - allowing request'
            };
        }
    }

    /**
     * Track request cost against budget
     */
    static async trackRequestCost(
        userId: string,
        budgetId: string,
        actualCost: number,
        reservationId?: string,
        workspaceId?: string
    ): Promise<void> {
        try {
            if (reservationId) {
                // Confirm budget reservation with actual cost
                await BudgetService.confirmBudget(reservationId, actualCost);
                
                loggingService.info('Budget reservation confirmed', {
                    userId,
                    budgetId,
                    reservationId,
                    actualCost
                });
            } else {
                // Direct cost tracking without reservation
                loggingService.info('Tracking cost without reservation', {
                    userId,
                    budgetId,
                    actualCost
                });
            }
        } catch (error: any) {
            loggingService.error('Failed to track request cost', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                userId,
                budgetId,
                reservationId
            });
        }
    }

    /**
     * Release budget reservation (on error or cancellation)
     */
    static async releaseBudgetReservation(reservationId: string): Promise<void> {
        try {
            await BudgetService.releaseBudget(reservationId);
            
            loggingService.info('Budget reservation released', {
                reservationId
            });
        } catch (error: any) {
            loggingService.error('Failed to release budget reservation', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                reservationId
            });
        }
    }

    /**
     * Extract prompt text from various request formats
     */
    private static extractPromptFromRequest(requestBody: any): string | null {
        if (!requestBody) return null;

        try {
            // OpenAI format
            if (requestBody.messages && Array.isArray(requestBody.messages)) {
                return requestBody.messages
                    .map((msg: any) => msg.content || '')
                    .filter((content: string) => content.trim().length > 0)
                    .join('\n');
            }

            // Anthropic format
            if (requestBody.prompt && typeof requestBody.prompt === 'string') {
                return requestBody.prompt;
            }

            // Google AI format
            if (requestBody.contents && Array.isArray(requestBody.contents)) {
                return requestBody.contents
                    .flatMap((content: any) => content.parts || [])
                    .map((part: any) => part.text || '')
                    .filter((text: string) => text.trim().length > 0)
                    .join('\n');
            }

            // Cohere format
            if (requestBody.message && typeof requestBody.message === 'string') {
                return requestBody.message;
            }

            // Generic text field
            if (requestBody.text && typeof requestBody.text === 'string') {
                return requestBody.text;
            }

            // Input field
            if (requestBody.input && typeof requestBody.input === 'string') {
                return requestBody.input;
            }

            return null;

        } catch (error: any) {
            loggingService.error('Error extracting prompt from request', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return null;
        }
    }
}
