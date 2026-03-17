import { Injectable, Logger, Optional } from '@nestjs/common';
import { BedrockService } from '../../modules/bedrock/bedrock.service';

export interface IntentAnalysis {
  intent:
    | 'test'
    | 'scaffold'
    | 'refactor'
    | 'fix'
    | 'explain'
    | 'document'
    | 'other';
  scope: 'file' | 'function' | 'module' | 'repository';
  language?: string;
  constraints?: {
    maxLOC?: number;
    requireTests?: boolean;
    styleGuide?: string;
  };
  riskLevel: 'low' | 'medium' | 'high';
  acceptanceCriteria?: string[];
}

export interface RequirementsAnalysis {
  intent: IntentAnalysis;
  detectedLanguage?: string;
  generationType:
    | 'test'
    | 'boilerplate'
    | 'refactor'
    | 'docs'
    | 'patch'
    | 'other';
  scope: IntentAnalysis['scope'];
  constraints: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Requirements analysis service for understanding user requests
 */
@Injectable()
export class RequirementsAnalysisService {
  private readonly logger = new Logger(RequirementsAnalysisService.name);

  constructor(@Optional() private readonly bedrockService?: BedrockService) {}

  /**
   * Analyze user request to extract intent, scope, language, and risk level.
   * Uses AI (Bedrock) when available, falls back to keyword-based heuristics.
   */
  async analyzeRequest(
    userRequest: string,
    repoContext?: {
      languages?: string[];
      framework?: string;
      packageManager?: string;
    },
  ): Promise<RequirementsAnalysis> {
    // Try AI-powered analysis first when Bedrock is available
    if (this.bedrockService) {
      try {
        const aiResult = await this.analyzeWithAI(userRequest, repoContext);
        if (aiResult) {
          return aiResult;
        }
      } catch (aiError) {
        this.logger.warn(
          'AI requirements analysis failed, falling back to keyword detection',
          {
            error: aiError instanceof Error ? aiError.message : 'Unknown',
          },
        );
      }
    }

    return this.analyzeWithKeywords(userRequest, repoContext);
  }

  /**
   * Analyze request using Bedrock AI for structured extraction
   */
  private async analyzeWithAI(
    userRequest: string,
    repoContext?: {
      languages?: string[];
      framework?: string;
      packageManager?: string;
    },
  ): Promise<RequirementsAnalysis | null> {
    const contextInfo = repoContext
      ? `Repository context: languages=[${repoContext.languages?.join(', ') || 'unknown'}], framework=${repoContext.framework || 'unknown'}, packageManager=${repoContext.packageManager || 'unknown'}`
      : 'No repository context available.';

    const prompt = `You are a code generation requirements analyzer. Analyze the following developer request and respond with ONLY a JSON object — no markdown, no explanation.

Request: "${userRequest}"
${contextInfo}

Respond with this exact JSON structure:
{
  "intent": "test" | "scaffold" | "refactor" | "fix" | "explain" | "document" | "other",
  "scope": "file" | "function" | "module" | "repository",
  "detectedLanguage": string or null,
  "generationType": "test" | "boilerplate" | "refactor" | "docs" | "patch" | "other",
  "riskLevel": "low" | "medium" | "high"
}`;

    const response = await BedrockService.invokeModel(
      prompt,
      'amazon.nova-pro-v1:0',
      { useSystemPrompt: false },
    );

    const text = (typeof response === 'string' ? response : '').trim();

    // Extract JSON from response (handle cases where model wraps in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const validIntents = [
      'test',
      'scaffold',
      'refactor',
      'fix',
      'explain',
      'document',
      'other',
    ];
    const validScopes = ['file', 'function', 'module', 'repository'];
    const validGenerationTypes = [
      'test',
      'boilerplate',
      'refactor',
      'docs',
      'patch',
      'other',
    ];
    const validRiskLevels = ['low', 'medium', 'high'];

    const intent = validIntents.includes(parsed.intent)
      ? parsed.intent
      : 'other';
    const scope = validScopes.includes(parsed.scope) ? parsed.scope : 'file';
    const generationType = validGenerationTypes.includes(parsed.generationType)
      ? parsed.generationType
      : 'other';
    const riskLevel = validRiskLevels.includes(parsed.riskLevel)
      ? parsed.riskLevel
      : 'medium';
    const detectedLanguage =
      typeof parsed.detectedLanguage === 'string'
        ? parsed.detectedLanguage
        : undefined;

    return {
      intent: {
        intent,
        scope,
        language: detectedLanguage || repoContext?.languages?.[0],
        riskLevel,
      },
      detectedLanguage: detectedLanguage || repoContext?.languages?.[0],
      generationType,
      scope,
      constraints: {},
      riskLevel,
    };
  }

  /**
   * Fallback: analyze using keyword patterns
   */
  private analyzeWithKeywords(
    userRequest: string,
    repoContext?: {
      languages?: string[];
      framework?: string;
      packageManager?: string;
    },
  ): RequirementsAnalysis {
    const intent = this.detectIntentFromKeywords(userRequest);
    const scope = this.detectScopeFromKeywords(userRequest);
    const language =
      repoContext?.languages?.[0] ||
      this.detectLanguageFromKeywords(userRequest);
    const riskLevel = this.detectRiskLevel(userRequest, intent);

    return {
      intent: {
        intent,
        scope,
        language,
        riskLevel,
      },
      detectedLanguage: language,
      generationType: this.mapIntentToGenerationType(intent),
      scope,
      constraints: {},
      riskLevel,
    };
  }

  /**
   * Detect intent from keywords
   */
  private detectIntentFromKeywords(request: string): IntentAnalysis['intent'] {
    const lower = request.toLowerCase();

    if (lower.includes('test') || lower.includes('spec')) {
      return 'test';
    }
    if (
      lower.includes('create') ||
      lower.includes('add') ||
      lower.includes('new') ||
      lower.includes('scaffold')
    ) {
      return 'scaffold';
    }
    if (
      lower.includes('refactor') ||
      lower.includes('improve') ||
      lower.includes('optimize')
    ) {
      return 'refactor';
    }
    if (
      lower.includes('fix') ||
      lower.includes('bug') ||
      lower.includes('error')
    ) {
      return 'fix';
    }
    if (
      lower.includes('explain') ||
      lower.includes('how') ||
      lower.includes('what')
    ) {
      return 'explain';
    }
    if (
      lower.includes('document') ||
      lower.includes('doc') ||
      lower.includes('comment')
    ) {
      return 'document';
    }

    return 'other';
  }

  /**
   * Detect scope from keywords
   */
  private detectScopeFromKeywords(request: string): IntentAnalysis['scope'] {
    const lower = request.toLowerCase();

    if (lower.includes('function') || lower.includes('method')) {
      return 'function';
    }
    if (lower.includes('module') || lower.includes('package')) {
      return 'module';
    }
    if (
      lower.includes('repo') ||
      lower.includes('repository') ||
      lower.includes('project')
    ) {
      return 'repository';
    }

    return 'file';
  }

  /**
   * Detect language from keywords
   */
  private detectLanguageFromKeywords(request: string): string | undefined {
    const lower = request.toLowerCase();
    const languageKeywords: Record<string, string> = {
      typescript: 'typescript',
      ts: 'typescript',
      javascript: 'javascript',
      js: 'javascript',
      python: 'python',
      py: 'python',
      java: 'java',
      go: 'go',
      rust: 'rust',
      cpp: 'cpp',
      'c++': 'cpp',
    };

    for (const [keyword, lang] of Object.entries(languageKeywords)) {
      if (lower.includes(keyword)) {
        return lang;
      }
    }

    return undefined;
  }

  /**
   * Detect risk level
   */
  private detectRiskLevel(
    request: string,
    intent: IntentAnalysis['intent'],
  ): 'low' | 'medium' | 'high' {
    const lower = request.toLowerCase();

    // High risk keywords
    if (
      lower.includes('auth') ||
      lower.includes('security') ||
      lower.includes('encrypt') ||
      lower.includes('password') ||
      lower.includes('token') ||
      lower.includes('key') ||
      lower.includes('infrastructure') ||
      lower.includes('infra') ||
      lower.includes('deploy')
    ) {
      return 'high';
    }

    // Medium risk
    if (
      lower.includes('database') ||
      lower.includes('api') ||
      lower.includes('endpoint') ||
      intent === 'refactor' ||
      intent === 'scaffold'
    ) {
      return 'medium';
    }

    // Low risk
    if (intent === 'test' || intent === 'document' || intent === 'explain') {
      return 'low';
    }

    return 'medium';
  }

  /**
   * Map intent to generation type
   */
  private mapIntentToGenerationType(
    intent: IntentAnalysis['intent'],
  ): RequirementsAnalysis['generationType'] {
    switch (intent) {
      case 'test':
        return 'test';
      case 'scaffold':
        return 'boilerplate';
      case 'refactor':
        return 'refactor';
      case 'document':
      case 'explain':
        return 'docs';
      case 'fix':
        return 'patch';
      default:
        return 'other';
    }
  }
}
