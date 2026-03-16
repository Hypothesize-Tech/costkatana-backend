import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../schemas/user/user.schema';
import { ProjectService } from '../project/project.service';
import { UsageService } from '../usage/services/usage.service';
import { MagicLinkService } from '../onboarding/magic-link.service';
import { AuthService } from '../auth/auth.service';
import { ApiKeyService } from '../api-key/api-key.service';
import { decrypt } from '../../utils/helpers';
import { CreateProjectDto } from '../project/dto/create-project.dto';

export interface ConnectionStatus {
  connected: boolean;
  userId?: string;
  user?: any;
  message: string;
  needsOnboarding?: boolean;
  magicLinkRequired?: boolean;
}

interface ChatGPTRequestBody {
  user_id?: string;
  api_key?: string;
  email?: string;
  name?: string;
  source?: string;
  onboarding?: {
    email: string;
    name?: string;
    source?: string;
    preferences?: {
      use_case?: string;
      ai_coaching?: boolean;
      email_insights?: boolean;
    };
  };
  conversation_data?: {
    prompt: string;
    response: string;
    model: string;
    tokens_used?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    conversation_id?: string;
    timestamp?: string;
  };
  project?: {
    name?: string;
    description?: string;
    budget_amount?: number;
    budget_period?: 'monthly' | 'quarterly' | 'yearly';
  };
  action: 'track_usage' | 'create_project' | 'get_projects' | 'get_analytics' | 'generate_magic_link' | 'check_connection';
}

@Injectable()
export class ChatGPTService {
  private readonly logger = new Logger(ChatGPTService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly projectService: ProjectService,
    private readonly usageService: UsageService,
    private readonly magicLinkService: MagicLinkService,
    private readonly authService: AuthService,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  /**
   * Check user connection status automatically
   */
  async checkConnectionStatus(body: ChatGPTRequestBody): Promise<ConnectionStatus> {
    const startTime = Date.now();
    const { user_id, api_key } = body;

    try {
      // If no authentication provided at all
      if (!user_id && !api_key) {
        this.logger.warn('Connection check failed - no authentication provided');

        return {
          connected: false,
          message: 'Welcome to Cost Katana! I need to connect you to start tracking your AI costs.',
          needsOnboarding: true,
          magicLinkRequired: true
        };
      }

      let userId: string | undefined;
      let user: any;

      // Check user_id authentication
      if (user_id) {
        if (user_id.includes('@')) {
          // It's an email, look up the actual user ObjectId
          user = await this.userModel.findOne({ email: user_id });
          if (!user) {
            this.logger.warn('Connection check failed - email not found', {
              email: user_id,
            });

            return {
              connected: false,
              message: `I don't see an account for ${user_id}. Let me create one for you with a magic link!`,
              needsOnboarding: true,
              magicLinkRequired: true
            };
          }
          userId = user._id.toString();
        } else {
          // It's an ObjectId
          user = await this.userModel.findById(user_id);
          if (!user) {
            this.logger.warn('Connection check failed - user ID not found', {
              userId: user_id,
            });

            return {
              connected: false,
              message: 'I found your user ID, but the account seems to be missing. Let me help you reconnect!',
              needsOnboarding: true,
              magicLinkRequired: true
            };
          }
          userId = user_id;
        }
      }
      // Check API key authentication
      else if (api_key) {
        let validation: any = null;

        // Try ChatGPT integration API keys (ck_user_ format)
        if (api_key.startsWith('ck_user_')) {
          validation = await this.apiKeyService.validateApiKey(api_key);
        }

        // Try dashboard API keys (dak_ format or full key)
        if (!validation) {
          try {
            if (api_key.startsWith('dak_')) {
              const parsedKey = this.authService.parseApiKey(api_key);
              if (parsedKey) {
                user = await this.userModel.findById(parsedKey.userId);
                if (user) {
                  const userApiKey = user.dashboardApiKeys.find((key: any) => key.keyId === parsedKey.keyId);
                  if (userApiKey && (!userApiKey.expiresAt || new Date() <= userApiKey.expiresAt)) {
                    try {
                      const [iv, authTag, encrypted] = userApiKey.encryptedKey.split(':');
                      const decryptedKey = decrypt(encrypted, iv, authTag);
                      if (decryptedKey === api_key) {
                        userApiKey.lastUsed = new Date();
                        await user.save();
                        validation = { userId: user._id.toString(), user };
                      }
                    } catch (error) {
                      this.logger.warn('Failed to decrypt dashboard API key', {
                        error: error instanceof Error ? error.message : 'Unknown error',
                      });
                    }
                  }
                }
              }
            } else {
              // Handle full dashboard API keys
              const userIdMatch = api_key.match(/^[a-f0-9]{24}_/);
              if (userIdMatch) {
                const potentialUserId = userIdMatch[0].slice(0, -1);
                user = await this.userModel.findById(potentialUserId);
                if (user && user.dashboardApiKeys) {
                  for (const userApiKey of user.dashboardApiKeys) {
                    if (!userApiKey.expiresAt || new Date() <= userApiKey.expiresAt) {
                      try {
                        const [iv, authTag, encrypted] = userApiKey.encryptedKey.split(':');
                        const decryptedKey = decrypt(encrypted, iv, authTag);
                        if (decryptedKey === api_key) {
                          userApiKey.lastUsed = new Date();
                          await user.save();
                          validation = { userId: user._id.toString(), user };
                          break;
                        }
                      } catch (error) {
                        continue;
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            this.logger.error('Error validating dashboard API key', {
              error: error instanceof Error ? error.message : 'Unknown error',
              stack: error instanceof Error ? error.stack : undefined,
            });
          }
        }

        if (!validation) {
          this.logger.warn('Connection check failed - invalid or expired API key', {
            apiKeyPrefix: api_key.substring(0, 8) + '...',
          });

          return {
            connected: false,
            message: 'I found your API key, but it seems to be invalid or expired. Let me help you get a new one!',
            needsOnboarding: true,
            magicLinkRequired: true
          };
        }
        userId = validation.userId;
        user = validation.user;
      }

      // User is connected
      if (userId && user) {
        const duration = Date.now() - startTime;

        // Log business event (simplified for NestJS)
        this.logger.log(`ChatGPT connection verified for user ${userId}`, {
          duration,
          userEmail: user.email,
          authMethod: user_id ? 'user_id' : 'api_key'
        });

        return {
          connected: true,
          userId,
          user,
          message: `Great! You're connected as ${user.email}. I'm ready to help you track and optimize your AI costs!`
        };
      }

      // Fallback case - should not reach here
      return {
        connected: false,
        message: 'I encountered an issue with your connection. Let me help you reconnect!',
        needsOnboarding: true,
        magicLinkRequired: true
      };
    } catch (error: any) {
      return {
        connected: false,
        message: 'I encountered an issue with your connection. Let me help you reconnect!',
        needsOnboarding: true,
        magicLinkRequired: true
      };
    }
  }

  /**
   * Generate magic link for seamless onboarding (sends email; user must already exist)
   */
  async generateMagicLink(email: string, name?: string, source?: string) {
    if (!email) {
      throw new Error('Email is required for magic link generation');
    }

    // Check if user exists, if not create minimal user record
    const existingUser = await this.userModel.findOne({ email }).exec();
    if (!existingUser) {
      this.logger.log(`Creating minimal user record for ChatGPT user: ${email}`);
      await this.userModel.create({
        email,
        name: name || email.split('@')[0], // Use part before @ as name if not provided
        source: 'chatgpt',
        isEmailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await this.magicLinkService.requestMagicLink(email);

    return {
      success: true,
      message: 'Magic link created successfully!',
      data: {
        expires_in_minutes: 15,
        instructions: [
          '🔗 Check your email and click the magic link',
          '📝 Complete the quick setup (30 seconds)',
          '🔄 Come back to this chat',
          '🎉 Start tracking your AI costs!'
        ],
        message: `Magic link sent to ${email}! Check your inbox and click the link to connect your account. The link expires in 24 hours.`
      }
    };
  }

  /**
   * Track ChatGPT conversation usage with AI-powered insights
   */
  async trackUsage(userId: string, conversationData: ChatGPTRequestBody['conversation_data']) {
    if (!conversationData) {
      throw new Error('conversation_data is required for track_usage action');
    }

    // Estimate tokens if not provided
    let promptTokens = conversationData.tokens_used?.prompt_tokens || 0;
    let completionTokens = conversationData.tokens_used?.completion_tokens || 0;
    let totalTokens = conversationData.tokens_used?.total_tokens || 0;

    if (!promptTokens && conversationData.prompt) {
      promptTokens = Math.ceil(conversationData.prompt.length / 4); // Rough estimation
    }

    if (!completionTokens && conversationData.response) {
      completionTokens = Math.ceil(conversationData.response.length / 4); // Rough estimation
    }

    if (!totalTokens) {
      totalTokens = promptTokens + completionTokens;
    }

    // Calculate cost based on model
    const cost = this.calculateChatGPTCost(
      conversationData.model || 'gpt-3.5-turbo',
      promptTokens,
      completionTokens
    );

    // Track the usage
    const usageData = {
      userId,
      service: 'openai',
      model: conversationData.model || 'gpt-3.5-turbo',
      prompt: conversationData.prompt,
      completion: conversationData.response,
      promptTokens,
      completionTokens,
      totalTokens,
      cost,
      responseTime: 0,
      metadata: {
        source: 'chatgpt-custom-gpt',
        conversation_id: conversationData.conversation_id,
        timestamp: conversationData.timestamp
      },
      tags: ['chatgpt', 'custom-gpt'],
      optimizationApplied: false,
      errorOccurred: false
    };

    const usage = await this.usageService.trackUsage(usageData);

    // Log business event (simplified for NestJS)
    this.logger.log(`ChatGPT usage tracked for user ${userId}`, {
      model: conversationData.model || 'gpt-3.5-turbo',
      totalTokens,
      cost,
      conversationId: conversationData.conversation_id,
    });

    return {
      usage_id: usage?._id,
      cost: usage?.cost,
      tokens: usage?.totalTokens,
      estimated_monthly_cost: cost * 30, // Rough estimate
      message: `Tracked ${totalTokens} tokens for $${cost.toFixed(6)}`,
    };
  }

  /**
   * Create a new project from ChatGPT
   */
  async createProject(userId: string, projectData: ChatGPTRequestBody['project']) {
    if (!projectData || !projectData.name) {
      throw new Error('Project data with name is required for create_project action');
    }

    const project: CreateProjectDto = {
      name: projectData.name,
      description: projectData.description || `Project created via ChatGPT on ${new Date().toLocaleDateString()}`,
      budget: {
        amount: projectData.budget_amount || 100,
        period: projectData.budget_period || 'monthly',
        currency: 'USD'
      },
      tags: ['chatgpt', 'auto-created']
    };

    const newProject = await this.projectService.createProject(userId, project);

    // Log business event (simplified for NestJS)
    this.logger.log(`ChatGPT project created for user ${userId}`, {
      projectId: newProject._id,
      projectName: newProject.name,
      budget: `${newProject.budget.amount} ${newProject.budget.period}`,
      source: 'chatgpt'
    });

    return {
      project_id: newProject._id,
      project_name: newProject.name,
      budget: `$${newProject.budget.amount} ${newProject.budget.period}`,
      message: `Project "${newProject.name}" created successfully! You can now track usage against this project.`
    };
  }

  /**
   * Get user's projects
   */
  async getProjects(userId: string) {
    const projects = await this.projectService.getUserProjects(userId);

    const projectSummary = projects.map(project => ({
      id: project._id,
      name: project.name,
      description: project.description,
      budget: `$${project.budget.amount} ${project.budget.period}`,
      current_spending: `$${project.spending.current.toFixed(2)}`,
      budget_used: project.budget.amount > 0 ? `${((project.spending.current / project.budget.amount) * 100).toFixed(1)}%` : '0%',
      status: project.isActive ? 'Active' : 'Inactive'
    }));

    // Log business event (simplified for NestJS)
    this.logger.log(`ChatGPT projects retrieved for user ${userId}`, {
      projectsCount: projects.length,
      activeProjects: projects.filter(p => p.isActive).length
    });

    return {
      projects: projectSummary,
      total_projects: projects.length,
      message: projects.length > 0
        ? `You have ${projects.length} project(s). Select one to track usage or create a new one.`
        : 'No projects found. Create your first project to start tracking AI costs!'
    };
  }

  /**
   * Get analytics summary
   */
  async getAnalytics(userId: string) {
    // Get user's recent usage stats
    const stats = await this.usageService.getUsageStats(userId, 'monthly');
    const projects = await this.projectService.getUserProjects(userId);

    const totalSpending = projects.reduce((sum, project) => sum + project.spending.current, 0);
    const totalBudget = projects.reduce((sum, project) => sum + project.budget.amount, 0);

    // Log business event (simplified for NestJS)
    this.logger.log(`ChatGPT analytics retrieved for user ${userId}`, {
      totalSpending,
      totalBudget,
      projectsCount: projects.length,
      activeProjects: projects.filter(p => p.isActive).length
    });

    return {
      summary: {
        total_spending_this_month: `$${totalSpending.toFixed(2)}`,
        total_budget: `$${totalBudget.toFixed(2)}`,
        budget_used: totalBudget > 0 ? `${((totalSpending / totalBudget) * 100).toFixed(1)}%` : '0%',
        active_projects: projects.filter(p => p.isActive).length,
        total_projects: projects.length
      },
      recent_activity: {
        total_requests: stats.totalRequests || 0,
        total_tokens: stats.totalTokens || 0,
        average_cost_per_request: stats.avgCostPerRequest || 0
      },
      message: `This month: $${totalSpending.toFixed(2)} spent across ${projects.length} projects. Budget utilization: ${totalBudget > 0 ? ((totalSpending / totalBudget) * 100).toFixed(1) : 0}%`
    };
  }

  /**
   * Calculate cost for ChatGPT models
   */
  private calculateChatGPTCost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing: Record<string, { prompt: number; completion: number }> = {
      'gpt-4o': { prompt: 2.5, completion: 10.0 },
      'gpt-4o-mini': { prompt: 0.15, completion: 0.60 },
      'gpt-4': { prompt: 30.0, completion: 60.0 },
      'gpt-4-turbo': { prompt: 10.0, completion: 30.0 },
      'gpt-4-turbo-preview': { prompt: 10.0, completion: 30.0 },
      'gpt-4-1106-preview': { prompt: 10.0, completion: 30.0 },
      'gpt-4-0125-preview': { prompt: 10.0, completion: 30.0 },
      'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
      'gpt-3.5-turbo-16k': { prompt: 3.0, completion: 4.0 },
      'gpt-3.5-turbo-1106': { prompt: 1.0, completion: 2.0 }
    };

    const modelPricing = pricing[model] || pricing['gpt-3.5-turbo'];
    const promptCost = (promptTokens / 1000000) * modelPricing.prompt; // Cost per million tokens
    const completionCost = (completionTokens / 1000000) * modelPricing.completion;

    return Number((promptCost + completionCost).toFixed(8));
  }
}