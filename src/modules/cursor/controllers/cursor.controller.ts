import {
  Controller,
  Get,
  Post,
  Body,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CursorService } from '../services/cursor.service';
import { MagicLinkService } from '../../onboarding/magic-link.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ApiKeyGuard } from '../../../common/guards/api-key.guard';
import { User } from '../../../schemas/user/user.schema';
import { EncryptionService } from '../../../common/encryption/encryption.service';

interface CursorRequestBody {
  user_id?: string;
  api_key?: string;
  email?: string;
  name?: string;
  source?: string;
  workspace?: {
    name?: string;
    path?: string;
    projectId?: string;
    language?: string;
    framework?: string;
  };
  code_context?: {
    file_path?: string;
    language?: string;
    code_snippet?: string;
    function_name?: string;
    class_name?: string;
    imports?: string[];
    dependencies?: string[];
  };
  ai_request?: {
    prompt: string;
    response: string;
    model: string;
    tokens_used?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    request_type: string;
    context_files?: string[];
    generated_files?: string[];
    execution_time?: number;
    success?: boolean;
    error_message?: string;
  };
  optimization_request?: {
    prompt: string;
    current_tokens: number;
    target_reduction?: number;
    preserve_quality?: boolean;
    context?: string;
  };
  action:
    | 'track_usage'
    | 'optimize_prompt'
    | 'get_suggestions'
    | 'analyze_code'
    | 'get_projects'
    | 'create_project'
    | 'get_analytics'
    | 'generate_magic_link'
    | 'workspace_setup';
}

@Controller('api/cursor')
@UseGuards(JwtAuthGuard, ApiKeyGuard)
export class CursorController {
  private readonly logger = new Logger(CursorController.name);

  constructor(
    private readonly cursorService: CursorService,
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly encryptionService: EncryptionService,
    private readonly magicLinkService: MagicLinkService,
  ) {}

  /**
   * Health check for Cursor extension
   */
  @Get('health')
  async healthCheck() {
    return {
      success: true,
      message:
        'Cursor extension integration with AI-powered code optimization is running',
      version: '1.0.0',
      features: [
        'usage_tracking',
        'prompt_optimization',
        'code_analysis',
        'smart_suggestions',
        'workspace_setup',
        'project_management',
        'multi_model_support',
        'cost_optimization',
        'real_time_analytics',
        'automatic_tracking',
      ],
      supported_models: {
        openai: [
          'gpt-4o',
          'gpt-4o-mini',
          'gpt-4.1',
          'gpt-4.5-preview',
          'gpt-3.5-turbo',
        ],
        anthropic: [
          'claude-3.5-sonnet',
          'claude-3.5-haiku',
          'claude-3.7-sonnet',
          'claude-4-opus',
          'claude-4-sonnet',
          'claude-3-opus',
          'claude-3-sonnet',
          'claude-3-haiku',
        ],
        google: ['gemini-2.0-pro', 'gemini-2.5-flash', 'gemini-2.5-pro'],
        deepseek: [
          'deepseek-r1',
          'deepseek-r1-05-28',
          'deepseek-v3',
          'deepseek-v3.1',
        ],
        grok: ['grok-2', 'grok-3-beta', 'grok-3-mini', 'grok-4'],
        anthropic_o: ['o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini'],
        cursor: ['cursor-small'],
      },
      supported_languages: [
        'javascript',
        'typescript',
        'python',
        'java',
        'kotlin',
        'c#',
        'go',
        'rust',
        'php',
        'ruby',
        'swift',
        'scala',
        'dart',
        'r',
        'matlab',
      ],
      supported_request_types: [
        'code_generation',
        'code_review',
        'bug_fix',
        'refactoring',
        'documentation',
        'testing',
        'optimization',
        'explanation',
      ],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Main action handler - handles all Cursor extension requests
   */
  @Post('action')
  async handleAction(@Body() body: CursorRequestBody) {
    const { action, user_id, api_key } = body;

    try {
      if (action === 'generate_magic_link') {
        return await this.generateMagicLink(body);
      }

      // Validate authentication - require either user_id or api_key
      let userId: string | null = null;

      if (user_id) {
        // Validate user_id format and existence
        if (!this.isValidUserId(user_id)) {
          return {
            success: false,
            error: 'invalid_user_id',
            message: 'Invalid user ID format',
          };
        }
        userId = user_id;
      } else if (api_key) {
        // Validate API key and extract user
        const apiKeyValidation = await this.validateApiKey(api_key);
        if (!apiKeyValidation.isValid) {
          return {
            success: false,
            error: 'invalid_api_key',
            message: 'Invalid or expired API key',
          };
        }
        userId = apiKeyValidation.userId ?? null;
      }

      if (!userId) {
        this.logger.warn('Cursor action failed - authentication required', {
          action,
          hasUserId: !!user_id,
          hasApiKey: !!api_key,
        });

        return {
          success: false,
          error: 'authentication_required',
          onboarding: true,
          message:
            'Welcome to Cost Katana for Cursor! Let me help you get connected in 30 seconds.',
          steps: [
            '1. Click "Generate Magic Link" below',
            '2. Enter your email address',
            '3. Check your email and click the magic link',
            '4. Complete your account setup',
            '5. Copy your API key from the dashboard',
            '6. Configure the extension with your API key',
          ],
          next_action: 'generate_magic_link',
        };
      }

      this.logger.log('Cursor action processing started', {
        action,
        userId,
        hasApiKey: !!api_key,
      });

      switch (action) {
        case 'track_usage':
          return await this.trackUsage(userId, body);
        case 'optimize_prompt':
          return await this.optimizePrompt(body);
        case 'get_suggestions':
          return await this.getSuggestions(body);
        case 'analyze_code':
          return await this.analyzeCode(body);
        case 'create_project':
          return await this.createProject(body);
        case 'get_projects':
          return await this.getProjects();
        case 'get_analytics':
          return await this.getAnalytics();
        case 'workspace_setup':
          return await this.setupWorkspace(body);
        default:
          return {
            success: false,
            error:
              'Invalid action. Supported actions: track_usage, optimize_prompt, get_suggestions, analyze_code, create_project, get_projects, get_analytics, generate_magic_link, workspace_setup',
          };
      }
    } catch (error) {
      this.logger.error(`❌ Cursor action failed: ${action}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ============================================================================
  // SPECIFIC ENDPOINT HANDLERS
  // ============================================================================

  @Post('track-usage')
  async trackUsageEndpoint(@Body() body: CursorRequestBody) {
    let userId: string | null = null;

    if (body.user_id) {
      if (!this.isValidUserId(body.user_id)) {
        return {
          success: false,
          error: 'invalid_user_id',
          message: 'Invalid user ID format',
        };
      }
      userId = body.user_id;
    } else if (body.api_key) {
      const apiKeyValidation = await this.validateApiKey(body.api_key);
      if (!apiKeyValidation.isValid) {
        return {
          success: false,
          error: 'invalid_api_key',
          message: 'Invalid or expired API key',
        };
      }
      userId = apiKeyValidation.userId ?? null;
    }

    if (!userId) {
      this.logger.warn('Track usage failed - authentication required', {
        hasUserId: !!body.user_id,
        hasApiKey: !!body.api_key,
      });
      return {
        success: false,
        error: 'authentication_required',
        onboarding: true,
        message:
          'Authentication required. Provide user_id or api_key. Use generate_magic_link to onboard.',
        next_action: 'generate_magic_link',
      };
    }

    return await this.trackUsage(userId, body);
  }

  @Post('optimize-prompt')
  async optimizePromptEndpoint(@Body() body: CursorRequestBody) {
    return await this.optimizePrompt(body);
  }

  @Post('get-suggestions')
  async getSuggestionsEndpoint(@Body() body: CursorRequestBody) {
    return await this.getSuggestions(body);
  }

  @Post('analyze-code')
  async analyzeCodeEndpoint(@Body() body: CursorRequestBody) {
    return await this.analyzeCode(body);
  }

  @Post('workspace-setup')
  async setupWorkspaceEndpoint(@Body() body: CursorRequestBody) {
    return await this.setupWorkspace(body);
  }

  @Post('projects')
  async createProjectEndpoint(@Body() body: CursorRequestBody) {
    return await this.createProject(body);
  }

  @Get('projects')
  async getProjectsEndpoint() {
    return await this.getProjects();
  }

  @Get('analytics')
  async getAnalyticsEndpoint() {
    return await this.getAnalytics();
  }

  @Post('magic-link')
  async generateMagicLinkEndpoint(@Body() body: CursorRequestBody) {
    return await this.generateMagicLink(body);
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async generateMagicLink(body: CursorRequestBody) {
    const { email, name } = body;

    if (!email) {
      return {
        success: false,
        error: 'Email is required',
        message: 'Please provide your email address to generate a magic link.',
      };
    }

    try {
      const existingUser = await this.userModel.findOne({ email }).exec();
      if (!existingUser) {
        this.logger.log(
          `Creating minimal user record for Cursor extension user: ${email}`,
        );
        await this.userModel.create({
          email,
          name: name || email.split('@')[0],
          source: 'cursor',
          isEmailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      await this.magicLinkService.requestMagicLink(email);

      return {
        success: true,
        data: {
          message:
            'Magic link sent to your email! Check your inbox and click the link to complete setup. The link expires in 24 hours.',
          expires_in_hours: 24,
          instructions: [
            'Check your email for the magic link',
            'Click the link to complete your account setup',
            'Copy your API key from the dashboard',
            'Configure the Cursor extension with your API key',
          ],
        },
      };
    } catch (error) {
      this.logger.error('Magic link generation failed', { email, error });
      return {
        success: false,
        error: 'magic_link_failed',
        message:
          error instanceof Error ? error.message : 'Failed to send magic link',
      };
    }
  }

  private async trackUsage(userId: string, body: CursorRequestBody) {
    const { ai_request, workspace, code_context } = body;

    if (!ai_request) {
      return {
        success: false,
        error: 'AI request data is required',
        message: 'Please provide the AI request details.',
      };
    }

    // Track the usage
    const usageResult = await this.cursorService.trackUsage({
      userId,
      aiRequest: ai_request,
      workspace,
      codeContext: code_context,
    });

    // Generate smart suggestions
    const suggestions = await this.cursorService.generateSmartSuggestions(
      userId,
      usageResult,
    );

    return {
      success: true,
      data: {
        usage_id: usageResult.usageId,
        cost: usageResult.cost.toFixed(8),
        tokens: usageResult.tokens,
        smart_tip: suggestions.tip,
        suggestions: suggestions.list,
        message: `Usage tracked successfully! Cost: $${usageResult.cost.toFixed(6)}`,
        breakdown: {
          promptTokens: usageResult.promptTokens,
          completionTokens: usageResult.completionTokens,
          model: usageResult.model,
        },
      },
    };
  }

  private async optimizePrompt(body: CursorRequestBody) {
    const { optimization_request } = body;

    if (!optimization_request) {
      return {
        success: false,
        error: 'Optimization request is required',
        message: 'Please provide the prompt to optimize.',
      };
    }

    const result =
      await this.cursorService.optimizePrompt(optimization_request);

    return {
      success: true,
      data: result,
    };
  }

  private async getSuggestions(body: CursorRequestBody) {
    const { code_context } = body;

    if (!code_context) {
      return {
        success: false,
        error: 'Code context is required',
        message: 'Please provide the code context for suggestions.',
      };
    }

    const suggestions = await this.cursorService.getSuggestions(code_context);

    return {
      success: true,
      data: {
        suggestions,
        context: {
          language: code_context.language,
          file_path: code_context.file_path,
        },
      },
    };
  }

  private async analyzeCode(body: CursorRequestBody) {
    const { code_context } = body;

    if (!code_context || !code_context.code_snippet) {
      return {
        success: false,
        error: 'Code snippet is required',
        message: 'Please provide the code snippet to analyze.',
      };
    }

    const analysis = await this.cursorService.analyzeCode(code_context);

    return {
      success: true,
      data: {
        analysis,
        recommendations: analysis.recommendations,
      },
    };
  }

  private async setupWorkspace(body: CursorRequestBody) {
    const { workspace } = body;

    if (!workspace) {
      return {
        success: false,
        error: 'Workspace data is required',
        message: 'Please provide workspace information.',
      };
    }

    const result = await this.cursorService.setupWorkspace(workspace);

    return {
      success: true,
      data: result,
    };
  }

  private async createProject(body: CursorRequestBody) {
    const { name } = body;

    if (!name) {
      return {
        success: false,
        error: 'Project name is required',
        message: 'Please provide a name for the project.',
      };
    }

    const result = await this.cursorService.createProject(name);

    return {
      success: true,
      data: result,
    };
  }

  private async getProjects() {
    const projects = await this.cursorService.getProjects();

    return {
      success: true,
      data: { projects },
    };
  }

  private async getAnalytics() {
    const analytics = await this.cursorService.getAnalytics();

    return {
      success: true,
      data: analytics,
    };
  }

  /**
   * Validate user ID format and existence
   */
  private isValidUserId(userId: string): boolean {
    // Basic format validation - should be a valid MongoDB ObjectId
    const objectIdRegex = /^[a-f\d]{24}$/i;
    return objectIdRegex.test(userId);
  }

  /**
   * Validate API key and return associated user
   */
  private async validateApiKey(
    apiKey: string,
  ): Promise<{ isValid: boolean; userId?: string }> {
    try {
      const parsedKey = this.parseApiKey(apiKey);
      if (!parsedKey) {
        return { isValid: false };
      }

      const { userId, keyId, secret } = parsedKey;

      const user = await this.userModel.findById(userId);
      if (!user) {
        return { isValid: false };
      }

      if (user.accountClosure?.status === 'deleted') {
        return { isValid: false };
      }

      const apiKeyDoc = user.dashboardApiKeys?.find(
        (key) =>
          key.keyId === keyId &&
          key.isActive !== false &&
          (!key.expiresAt || key.expiresAt > new Date()),
      );

      if (!apiKeyDoc) {
        return { isValid: false };
      }

      const [iv, authTag, encrypted] = apiKeyDoc.encryptedKey.split(':');
      if (!iv || !authTag || !encrypted) {
        return { isValid: false };
      }

      let decryptedSecret: string;
      try {
        decryptedSecret = this.encryptionService.decrypt(
          apiKeyDoc.encryptedKey,
        );
      } catch {
        return { isValid: false };
      }

      if (secret !== decryptedSecret) {
        return { isValid: false };
      }

      return { isValid: true, userId: userId.toString() };
    } catch (error) {
      this.logger.error('API key validation error', { error });
      return { isValid: false };
    }
  }

  private parseApiKey(
    apiKey: string,
  ): { userId: string; keyId: string; secret: string } | null {
    const parts = apiKey.split('_');
    if (parts.length !== 4 || parts[0] !== 'dak') return null;
    return { userId: parts[1], keyId: parts[2], secret: parts[3] };
  }
}
