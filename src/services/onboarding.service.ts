import { User } from '../models/User';
import { ProjectService } from './project.service';
import { ChatService } from './chat.service';
import { UsageService } from './usage.service';
import { loggingService } from './logging.service';

interface OnboardingStep {
    id: string;
    name: string;
    completed: boolean;
    data?: any;
}

interface OnboardingData {
    userId: string;
    currentStep: number;
    steps: OnboardingStep[];
    completed: boolean;
    startedAt: Date;
    completedAt?: Date;
    skipped?: boolean;
    skippedAt?: Date;
}

interface CreateProjectData {
    name: string;
    description?: string;
    budget?: {
        amount: number;
        period: 'monthly' | 'quarterly' | 'yearly' | 'one-time';
        currency?: string;
    };
    settings?: {
        requireApprovalAbove?: number;
        enablePromptLibrary?: boolean;
        enableCostAllocation?: boolean;
    };
}

interface LlmQueryData {
    query: string;
    model: string;
    projectId: string;
    userId: string;
}

export class OnboardingService {
    private static readonly ONBOARDING_STEPS = [
        { id: 'welcome', name: 'Welcome' },
        { id: 'project_creation', name: 'Create Project' },
        { id: 'project_pricing', name: 'Set Project Pricing' },
        { id: 'llm_query', name: 'Make First LLM Call' },
        { id: 'completion', name: 'Complete Setup' }
    ];

    /**
     * Check if user needs onboarding
     */
    static async needsOnboarding(userId: string): Promise<boolean> {
        try {
            const user = await User.findById(userId).select('onboarding projects').lean();
            if (!user) return true;

            // Check if onboarding is completed or skipped
            if (user.onboarding?.completed || (user.onboarding as any)?.skipped) return false;

            // If user has projects but didn't complete onboarding, still show onboarding
            // This ensures they complete the full flow
            return true;
        } catch (error) {
            loggingService.error('Error checking onboarding status:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return true;
        }
    }

    /**
     * Get user's onboarding status
     */
    static async getOnboardingStatus(userId: string): Promise<OnboardingData | null> {
        try {
            const user = await User.findById(userId).select('onboarding').lean();
            if (!user) return null;

            const onboarding: any = user.onboarding || {
                completed: false,
                skipped: false,
                projectCreated: false,
                firstLlmCall: false,
                stepsCompleted: []
            };

            // Create steps array based on completion status
            const steps: OnboardingStep[] = this.ONBOARDING_STEPS.map(step => ({
                id: step.id,
                name: step.name,
                completed: onboarding.stepsCompleted?.includes(step.id) || false,
                data: this.getStepData(step.id, onboarding)
            }));

            return {
                userId,
                currentStep: this.getCurrentStep(steps),
                steps,
                completed: onboarding.completed || false,
                startedAt: onboarding.completedAt || new Date(),
                completedAt: onboarding.completedAt,
                skipped: onboarding.skipped || false,
                skippedAt: onboarding.skippedAt
            };
        } catch (error) {
            loggingService.error('Error getting onboarding status:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return null;
        }
    }

    /**
     * Initialize onboarding for user
     */
    static async initializeOnboarding(userId: string): Promise<OnboardingData> {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('User not found');

            // Initialize onboarding data
            (user.onboarding as any) = {
                completed: false,
                skipped: false,
                projectCreated: false,
                firstLlmCall: false,
                stepsCompleted: []
            };

            await user.save();

            const steps: OnboardingStep[] = this.ONBOARDING_STEPS.map(step => ({
                id: step.id,
                name: step.name,
                completed: false
            }));

            return {
                userId,
                currentStep: 0,
                steps,
                completed: false,
                startedAt: new Date(),
                skipped: false
            };
        } catch (error) {
            loggingService.error('Error initializing onboarding:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Complete onboarding step
     */
    static async completeStep(userId: string, stepId: string, data?: any): Promise<OnboardingData> {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('User not found');

            if (!user.onboarding) {
                await this.initializeOnboarding(userId);
                await user.save();
            }

            // Add step to completed steps if not already completed
            if (!user.onboarding.stepsCompleted?.includes(stepId)) {
                user.onboarding.stepsCompleted = user.onboarding.stepsCompleted || [];
                user.onboarding.stepsCompleted.push(stepId);
            }

            // Update step-specific flags
            switch (stepId) {
                case 'project_creation':
                    user.onboarding.projectCreated = true;
                    break;
                case 'llm_query':
                    user.onboarding.firstLlmCall = true;
                    break;
                case 'completion':
                    user.onboarding.completed = true;
                    user.onboarding.completedAt = new Date();
                    break;
            }

            await user.save();

            // Log completion
            loggingService.info('Onboarding step completed:', {
                userId,
                stepId,
                completedSteps: user.onboarding.stepsCompleted,
                onboardingCompleted: user.onboarding.completed
            });

            return this.getOnboardingStatus(userId) as Promise<OnboardingData>;
        } catch (error) {
            loggingService.error('Error completing onboarding step:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
                stepId
            });
            throw error;
        }
    }

    /**
     * Create project during onboarding
     */
    static async createProject(userId: string, projectData: CreateProjectData): Promise<any> {
        try {
            // Create project with default settings for onboarding
            const project = await ProjectService.createProject(userId, {
                name: projectData.name,
                description: projectData.description || `Project created during onboarding`,
                budget: {
                    amount: projectData.budget?.amount || 100,
                    period: projectData.budget?.period || 'monthly',
                    currency: projectData.budget?.currency || 'USD',
                    alerts: [
                        { threshold: 50, type: 'in-app' },
                        { threshold: 80, type: 'both' },
                        { threshold: 90, type: 'both' }
                    ]
                },
                settings: {
                    requireApprovalAbove: projectData.settings?.requireApprovalAbove || 100,
                    enablePromptLibrary: projectData.settings?.enablePromptLibrary !== false,
                    enableCostAllocation: projectData.settings?.enableCostAllocation !== false,
                    ...projectData.settings
                }
            });

            // Complete project creation step
            await this.completeStep(userId, 'project_creation', {
                projectId: project._id,
                projectName: project.name
            });

            loggingService.info('Project created during onboarding:', {
                userId,
                projectId: project._id,
                projectName: project.name
            });

            return project;
        } catch (error) {
            loggingService.error('Error creating project during onboarding:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
                projectData
            });
            throw error;
        }
    }

    /**
     * Execute LLM query during onboarding
     */
    static async executeLlmQuery(userId: string, queryData: LlmQueryData): Promise<any> {
        try {
            // Get user's projects to find the most recent one for the query
            const projects = await ProjectService.getUserProjects(userId);
            if (projects.length === 0) {
                throw new Error('No project found for onboarding query');
            }

            const projectId = projects[0]._id.toString();
            queryData.projectId = projectId;

            // This will make a real LLM call and track usage
            const response = await this.makeLlmCall(queryData);

            // Complete LLM query step
            await this.completeStep(userId, 'llm_query', {
                query: queryData.query,
                model: queryData.model,
                response: response.content,
                projectId: projectId
            });

            loggingService.info('LLM query executed during onboarding:', {
                userId,
                model: queryData.model,
                projectId: projectId,
                query: queryData.query.substring(0, 100) + '...'
            });

            return response;
        } catch (error) {
            loggingService.error('Error executing LLM query during onboarding:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
                queryData
            });
            throw error;
        }
    }

    /**
     * Make actual LLM call (abstracted to hide implementation details)
     */
    private static async makeLlmCall(queryData: LlmQueryData): Promise<any> {
        try {
            // Create a conversation for the LLM call
            const conversation = await ChatService.createConversation({
                userId: queryData.userId,
                title: `Onboarding Query - ${queryData.query.substring(0, 50)}...`,
                modelId: queryData.model
            });

            // Send the message using ChatService
            const response = await ChatService.sendMessage({
                userId: queryData.userId,
                message: queryData.query,
                modelId: queryData.model,
                conversationId: conversation.id
            });

            // Track the usage for the onboarding query
            const usageData = {
                userId: queryData.userId,
                projectId: queryData.projectId,
                service: 'bedrock',
                model: queryData.model,
                prompt: queryData.query,
                completion: response.response,
                promptTokens: Math.ceil(queryData.query.length / 4), // Estimate input tokens (ChatService handles actual counting) 
                completionTokens: response.tokenCount || Math.ceil(response.response.length / 4),
                totalTokens: (Math.ceil(queryData.query.length / 4) + (response.tokenCount || Math.ceil(response.response.length / 4))),
                cost: response.cost,
                responseTime: response.latency || 0,
                metadata: {
                    source: 'onboarding',
                    conversationId: conversation.id,
                    isOnboarding: true,
                    modelProvider: 'bedrock'
                },
                tags: ['onboarding', 'first-query', queryData.model]
            };

            UsageService.trackUsage(usageData).catch(error => {
                loggingService.warn('Failed to track onboarding usage:', {
                    error: error instanceof Error ? error.message : String(error),
                    userId: queryData.userId
                });
            });

            return {
                content: response.response,
                model: response.model,
                tokens: response.tokenCount,
                cost: response.cost
            };
        } catch (error) {
            loggingService.error('Error making LLM call:', {
                error: error instanceof Error ? error.message : String(error),
                queryData
            });
            throw error;
        }
    }

    /**
     * Complete onboarding process
     */
    static async completeOnboarding(userId: string): Promise<OnboardingData> {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('User not found');

            // Mark onboarding as completed
            (user.onboarding as any) = (user.onboarding as any) || {};
            (user.onboarding as any).completed = true;
            (user.onboarding as any).skipped = false; // Ensure it's not marked as skipped when completing
            (user.onboarding as any).completedAt = new Date();

            await user.save();

            // Complete the final step
            await this.completeStep(userId, 'completion');

            loggingService.info('Onboarding completed successfully:', {
                userId,
                completedAt: user.onboarding.completedAt
            });

            return this.getOnboardingStatus(userId) as Promise<OnboardingData>;
        } catch (error) {
            loggingService.error('Error completing onboarding:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Skip onboarding process
     */
    static async skipOnboarding(userId: string): Promise<OnboardingData> {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('User not found');

            // Mark onboarding as skipped
            (user.onboarding as any) = (user.onboarding as any) || {};
            (user.onboarding as any).skipped = true;
            (user.onboarding as any).completed = false; // Ensure it's not marked as completed when skipping
            (user.onboarding as any).skippedAt = new Date();

            await user.save();

            loggingService.info('Onboarding skipped successfully:', {
                userId,
                skippedAt: (user.onboarding as any).skippedAt
            });

            return this.getOnboardingStatus(userId) as Promise<OnboardingData>;
        } catch (error) {
            loggingService.error('Error skipping onboarding:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Get current step based on completed steps
     */
    private static getCurrentStep(steps: OnboardingStep[]): number {
        const completedCount = steps.filter(step => step.completed).length;
        return Math.min(completedCount, this.ONBOARDING_STEPS.length - 1);
    }

    /**
     * Get step data based on completion status
     */
    private static getStepData(stepId: string, onboarding: any): any {
        switch (stepId) {
            case 'project_creation':
                return { projectCreated: onboarding.projectCreated };
            case 'llm_query':
                return { firstLlmCall: onboarding.firstLlmCall };
            default:
                return null;
        }
    }

    /**
     * Get available LLM models for onboarding
     */
    static getAvailableModels(): Array<{ id: string; name: string; provider: string }> {
        return [
            { id: 'gpt-4', name: 'GPT-4', provider: 'OpenAI' },
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI' },
            { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic' },
            { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'Anthropic' },
            { id: 'gemini-pro', name: 'Gemini Pro', provider: 'Google' }
        ];
    }
}
