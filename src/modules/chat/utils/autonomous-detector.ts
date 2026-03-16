import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  AIRouterService,
  ModelInvocationRequest,
} from '../../../modules/cortex/services/ai-router.service';

@Injectable()
export class AutonomousDetector {
  constructor(
    private readonly loggingService: LoggerService,
    private readonly aiRouterService: AIRouterService,
  ) {}

  // Keywords that indicate autonomous request
  private readonly autonomousKeywords = [
    'create',
    'build',
    'deploy',
    'develop',
    'make',
    'setup',
    'implement',
    'generate',
    'scaffold',
    'initialize',
    'configure',
    'establish',
    'design',
    'architect',
    'construct',
    'launch',
    'ship',
    'release',
    'write',
    'code',
    'program',
  ];

  // Keywords that indicate project-related requests
  private readonly projectKeywords = [
    'app',
    'application',
    'website',
    'api',
    'service',
    'project',
    'system',
    'platform',
    'solution',
    'software',
    'tool',
    'product',
    'todo',
    'list',
    'mern',
    'react',
    'node',
    'fullstack',
    'backend',
    'frontend',
  ];

  // Patterns that indicate building something
  private readonly buildPatterns = [
    /build\s+(?:a|an|the)?\s*\w+/i,
    /create\s+(?:a|an|the)?\s*\w+/i,
    /make\s+(?:a|an|me|the)?\s*\w+/i,
    /develop\s+(?:a|an|the)?\s*\w+/i,
    /deploy\s+(?:a|an|the|my)?\s*\w+/i,
    /i\s+(?:want|need)\s+(?:to\s+)?(?:build|create|make)/i,
    /(?:can|could)\s+you\s+(?:build|create|make)/i,
  ];

  /**
   * Detect if a message requires autonomous agent workflow
   */
  async detect(message: string): Promise<boolean> {
    try {
      const messageLower = message.toLowerCase();

      // 1. Check for autonomous keywords
      const hasAutonomousKeyword = this.hasAutonomousKeyword(messageLower);
      if (hasAutonomousKeyword) {
        this.loggingService.info(
          '🤖 Autonomous request detected via keywords',
          {
            message: message.substring(0, 100),
            hasAutonomousKeyword,
            hasProjectKeyword: this.hasProjectKeyword(messageLower),
          },
        );
        return true;
      }

      // 2. Check for specific build patterns
      const matchesPattern = this.matchesBuildPattern(message);
      if (matchesPattern) {
        this.loggingService.info('🤖 Autonomous request detected via pattern', {
          message: message.substring(0, 100),
        });
        return true;
      }

      // 3. For edge cases, use AI for more sophisticated detection
      const aiDetected = await this.detectWithAI(message);

      this.loggingService.info('🤖 Autonomous request detection result', {
        message: message.substring(0, 100),
        detected: aiDetected,
        method: 'AI',
      });

      return aiDetected;
    } catch (error) {
      this.loggingService.error('Failed to detect autonomous request', {
        error: error instanceof Error ? error.message : String(error),
        message,
      });
      return false;
    }
  }

  /**
   * Check if message has autonomous keywords
   */
  private hasAutonomousKeyword(messageLower: string): boolean {
    return this.autonomousKeywords.some((keyword) =>
      messageLower.includes(keyword),
    );
  }

  /**
   * Check if message has project keywords
   */
  private hasProjectKeyword(messageLower: string): boolean {
    return this.projectKeywords.some((keyword) =>
      messageLower.includes(keyword),
    );
  }

  /**
   * Check if message matches build patterns
   */
  private matchesBuildPattern(message: string): boolean {
    return this.buildPatterns.some((pattern) => pattern.test(message));
  }

  /**
   * Use AI to detect autonomous intent for edge cases
   */
  private async detectWithAI(message: string): Promise<boolean> {
    try {
      const prompt = `Analyze if this message requires an autonomous agent workflow (creating projects, deploying code, building applications, etc.).

Message: "${message}"

Respond with ONLY "true" or "false". Consider:
- Does this involve creating, building, or deploying software?
- Does this require multiple steps or complex coordination?
- Is this asking for automated execution rather than just information?
- Does this involve integrations, APIs, or external services?
- Is this a development or operational task rather than just a question?

Answer:`;

      const request: ModelInvocationRequest = {
        model: 'amazon.nova-lite-v1:0', // Use a lightweight model for this classification task
        prompt,
        parameters: {
          temperature: 0.1, // Low temperature for consistent classification
          maxTokens: 10, // Very short response needed
        },
        metadata: {
          requestId: `autonomous-detect-${Date.now()}`,
          costPriority: 'lowest', // This is a simple classification task
        },
      };

      const result = await this.aiRouterService.invokeModel(request);

      // Parse the response
      const response = result.response.trim().toLowerCase();
      const detected = response === 'true';

      this.loggingService.debug('AI autonomous detection completed', {
        message: message.substring(0, 100),
        response,
        detected,
        model: result.model,
        tokens: result.usage.totalTokens,
        cost: result.cost,
        latency: result.latency,
      });

      return detected;
    } catch (error) {
      this.loggingService.error('AI autonomous detection failed', {
        error: error instanceof Error ? error.message : String(error),
        message: message.substring(0, 100),
      });

      // Fallback to false on error to avoid breaking the flow
      return false;
    }
  }
}
