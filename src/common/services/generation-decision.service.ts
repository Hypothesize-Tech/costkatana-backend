import { Injectable, Logger } from '@nestjs/common';
import {
  RequirementsAnalysisService,
  RequirementsAnalysis,
} from './requirements-analysis.service';
import { LanguagePrioritizerService } from './language-prioritizer.service';

export interface GenerationDecision {
  shouldGenerate: boolean;
  generationType:
    | 'test'
    | 'boilerplate'
    | 'refactor'
    | 'docs'
    | 'patch'
    | 'other';
  scope: 'file' | 'function' | 'module' | 'repository';
  language: string;
  requiresApproval: boolean;
  estimatedLOC: number;
  conflicts: string[];
  prerequisites: string[];
  templates?: string[];
  riskLevel: 'low' | 'medium' | 'high';
  /** When shouldGenerate is false, explains why generation was blocked. */
  reason?: string;
  /** When shouldGenerate is false, list of issues that must be resolved first. */
  blockingIssues?: string[];
}

export interface GenerationContext {
  userRequest: string;
  repoContext?: {
    languages?: string[];
    framework?: string;
    packageManager?: string;
    existingFiles?: string[];
  };
  existingCode?: Record<string, string>;
}

/** LOC above which human approval is required. */
const LOC_THRESHOLD_REQUIRES_APPROVAL = 200;
/** Codebase size (lines) considered "large" for complexity multiplier. */
const LARGE_CODEBASE_LINES = 5000;
const VERY_LARGE_CODEBASE_LINES = 10000;
/** Minimum non-empty request length to attempt generation. */
const MIN_REQUEST_LENGTH = 3;
/** Max request length to avoid abuse (optional guard). */
const MAX_REQUEST_LENGTH = 50_000;

/** Known template identifiers by generation type and framework. */
const TEMPLATE_BY_FRAMEWORK: Record<string, string[]> = {
  react: ['react_component', 'react_hook', 'react_test'],
  vue: ['vue_component', 'vue_composition', 'vue_test'],
  angular: ['angular_component', 'angular_service', 'angular_test'],
  nestjs: ['nestjs_controller', 'nestjs_service', 'nestjs_module'],
  express: ['express_route', 'express_middleware'],
  jest: ['test_jest', 'test_jest_integration'],
  vitest: ['test_vitest', 'test_vitest_component'],
  pytest: ['test_pytest', 'test_pytest_fixture'],
  mocha: ['test_mocha', 'test_mocha_chai'],
};

/**
 * Generation decision service.
 * Decides what code to generate based on user intent, repo context, and existing code.
 * Produces a structured decision including whether to generate, approval requirements, and recommended templates.
 */
@Injectable()
export class GenerationDecisionService {
  private readonly logger = new Logger(GenerationDecisionService.name);

  constructor(
    private readonly requirementsAnalysisService: RequirementsAnalysisService,
    private readonly languagePrioritizerService: LanguagePrioritizerService,
  ) {}

  /**
   * Produce a generation decision for the given context.
   * Sets shouldGenerate to false when blocked by conflicts, prerequisites, or validation.
   */
  async makeDecision(context: GenerationContext): Promise<GenerationDecision> {
    try {
      const validationError = this.validateContext(context);
      if (validationError) {
        return this.buildBlockedDecision(context, false, validationError, [
          validationError,
        ]);
      }

      const requirements =
        await this.requirementsAnalysisService.analyzeRequest(
          context.userRequest,
          context.repoContext,
        );

      const language = this.determineLanguage(
        requirements,
        context.repoContext,
      );
      const conflicts = this.detectConflicts(
        context.userRequest,
        context.existingCode,
      );
      const requiresApproval = this.requiresApproval(requirements, context);
      const estimatedLOC = this.estimateLOC(requirements, context);
      const prerequisites = this.checkPrerequisites(
        requirements,
        context,
        language,
      );
      const templates = this.selectTemplates(
        requirements,
        language,
        context.repoContext,
      );

      const blockingIssues = this.collectBlockingIssues({
        conflicts,
        prerequisites,
        language,
        requirements,
      });

      const shouldGenerate =
        blockingIssues.length === 0 &&
        language !== 'unknown' &&
        this.languagePrioritizerService.isLanguageSupported(language);

      const decision: GenerationDecision = {
        shouldGenerate,
        generationType: requirements.generationType,
        scope: requirements.scope,
        language,
        requiresApproval,
        estimatedLOC,
        conflicts,
        prerequisites,
        templates,
        riskLevel: requirements.riskLevel,
        reason: shouldGenerate
          ? undefined
          : this.formatBlockedReason(blockingIssues, language),
        blockingIssues: shouldGenerate ? undefined : blockingIssues,
      };

      this.logger.log('Generation decision made', {
        shouldGenerate: decision.shouldGenerate,
        generationType: decision.generationType,
        scope: decision.scope,
        language: decision.language,
        requiresApproval: decision.requiresApproval,
        conflictCount: decision.conflicts.length,
        prerequisiteCount: decision.prerequisites.length,
      });

      return decision;
    } catch (error) {
      this.logger.error('Generation decision failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });

      return this.buildBlockedDecision(
        context,
        true,
        'Generation decision failed due to an internal error.',
        [error instanceof Error ? error.message : 'Unknown'],
      );
    }
  }

  /**
   * Validate context before analysis. Returns an error message if invalid.
   */
  private validateContext(context: GenerationContext): string | null {
    const trimmed = context.userRequest.trim();
    if (trimmed.length < MIN_REQUEST_LENGTH) {
      return 'Request is too short or empty.';
    }
    if (trimmed.length > MAX_REQUEST_LENGTH) {
      return 'Request exceeds maximum allowed length.';
    }
    return null;
  }

  /**
   * Build a decision with shouldGenerate false and reason/blockingIssues set.
   */
  private buildBlockedDecision(
    context: GenerationContext,
    requiresApproval: boolean,
    reason: string,
    blockingIssues: string[],
  ): GenerationDecision {
    return {
      shouldGenerate: false,
      generationType: 'other',
      scope: 'file',
      language: context.repoContext?.languages?.[0] ?? 'unknown',
      requiresApproval,
      estimatedLOC: 0,
      conflicts: [],
      prerequisites: [],
      riskLevel: 'high',
      reason,
      blockingIssues,
    };
  }

  /**
   * Collect all issues that block generation (conflicts + prerequisites + language).
   */
  private collectBlockingIssues(params: {
    conflicts: string[];
    prerequisites: string[];
    language: string;
    requirements: RequirementsAnalysis;
  }): string[] {
    const { conflicts, prerequisites, language, requirements } = params;
    const issues: string[] = [];

    if (conflicts.length > 0) {
      issues.push(...conflicts);
    }

    const blockingPrereqs = prerequisites.filter(
      (p) =>
        p.includes('may not be fully supported') ||
        p.includes('must be') ||
        p.includes('required'),
    );
    if (blockingPrereqs.length > 0) {
      issues.push(...blockingPrereqs);
    }

    if (language === 'unknown') {
      issues.push(
        'Target language could not be determined. Specify the language or ensure repo context includes languages.',
      );
    } else if (!this.languagePrioritizerService.isLanguageSupported(language)) {
      issues.push(
        `Language "${language}" is not fully supported for generation.`,
      );
    }

    if (
      requirements.riskLevel === 'high' &&
      (requirements.intent?.constraints?.maxLOC ?? 0) === 0
    ) {
      // High risk with no explicit max LOC is not blocking, but we already require approval
    }

    return issues;
  }

  private formatBlockedReason(
    blockingIssues: string[],
    language: string,
  ): string {
    if (blockingIssues.length === 0 && language === 'unknown') {
      return 'Target language could not be determined.';
    }
    if (blockingIssues.length === 0) {
      return 'Generation was blocked (no specific issues reported).';
    }
    return `Blocked: ${blockingIssues.slice(0, 3).join('; ')}${blockingIssues.length > 3 ? '...' : ''}`;
  }

  private determineLanguage(
    requirements: RequirementsAnalysis,
    repoContext?: GenerationContext['repoContext'],
  ): string {
    if (requirements.detectedLanguage) {
      return requirements.detectedLanguage;
    }
    if (repoContext?.languages && repoContext.languages.length > 0) {
      const prioritized = this.languagePrioritizerService.prioritizeLanguages(
        repoContext.languages,
      );
      return prioritized.primaryLanguage;
    }
    return 'unknown';
  }

  /**
   * Detect conflicts with existing code: duplicate symbols, export clashes, and path overlaps.
   */
  private detectConflicts(
    userRequest: string,
    existingCode?: Record<string, string>,
  ): string[] {
    const conflicts: string[] = [];
    if (!existingCode || Object.keys(existingCode).length === 0) {
      return conflicts;
    }

    const lowerRequest = userRequest.toLowerCase();

    // Names that might be introduced (multiple patterns)
    const proposedNames = this.extractProposedSymbolNames(userRequest);
    if (proposedNames.size > 0) {
      for (const [filePath, content] of Object.entries(existingCode)) {
        for (const name of proposedNames) {
          if (this.symbolExistsInContent(content, name)) {
            conflicts.push(
              `Symbol "${name}" may already exist in ${filePath}.`,
            );
          }
        }
      }
    }

    // Export/import clashes: request mentions a file or module that exists
    const mentionedPaths = this.extractMentionedPaths(userRequest);
    for (const pathHint of mentionedPaths) {
      const normalized = pathHint.toLowerCase().replace(/\\/g, '/');
      const hasOverlap = Object.keys(existingCode).some(
        (p) =>
          p.toLowerCase().replace(/\\/g, '/').includes(normalized) ||
          normalized.includes(p.toLowerCase().replace(/\\/g, '/')),
      );
      if (hasOverlap) {
        conflicts.push(
          `Request references path or module that may overlap with existing file: ${pathHint}`,
        );
      }
    }

    // "Create" / "add" duplicate check (original heuristic, keep for backward compatibility)
    if (lowerRequest.includes('create') || lowerRequest.includes('add')) {
      const namePattern =
        /(?:create|add)\s+(?:a\s+)?(?:new\s+)?(?:function|class|method|component|module|file)\s+([A-Za-z][A-Za-z0-9_]*)/gi;
      let match: RegExpExecArray | null;
      while ((match = namePattern.exec(userRequest)) !== null) {
        const proposedName = match[1];
        for (const [filePath, content] of Object.entries(existingCode)) {
          if (this.symbolExistsInContent(content, proposedName)) {
            conflicts.push(
              `Potential duplicate: ${proposedName} may already exist in ${filePath}.`,
            );
          }
        }
      }
    }

    return [...new Set(conflicts)];
  }

  /** Extract symbol names that might be created (PascalCase, camelCase, or quoted). */
  private extractProposedSymbolNames(request: string): Set<string> {
    const names = new Set<string>();
    const pascal =
      /(?:function|class|component|interface|type|enum)\s+([A-Z][A-Za-z0-9_]*)/g;
    const camel = /(?:const|let|var)\s+([a-z][A-Za-z0-9_]*)\s*=/g;
    const quoted = /["']([A-Za-z][A-Za-z0-9_-]*)["']/g;
    let m: RegExpExecArray | null;
    while ((m = pascal.exec(request)) !== null) names.add(m[1]);
    while ((m = camel.exec(request)) !== null) names.add(m[1]);
    while ((m = quoted.exec(request)) !== null) names.add(m[1]);
    return names;
  }

  /** Check if a symbol (function/class/const/export) appears in content. */
  private symbolExistsInContent(content: string, symbolName: string): boolean {
    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`\\bfunction\\s+${escaped}\\b`),
      new RegExp(`\\bclass\\s+${escaped}\\b`),
      new RegExp(`\\bconst\\s+${escaped}\\s*=`),
      new RegExp(
        `\\bexport\\s+(?:default\\s+)?(?:function|class|const)\\s+${escaped}\\b`,
      ),
      new RegExp(`\\b(?:interface|type)\\s+${escaped}\\b`),
      new RegExp(`\\b${escaped}\\s*\\(`),
    ];
    return patterns.some((p) => p.test(content));
  }

  /** Extract path-like or module-like strings from the request. */
  private extractMentionedPaths(request: string): string[] {
    const paths: string[] = [];
    const pathLike =
      /(?:from|import|require|path|file)\s*[(\s'"`]([^'"`)\s]+)/gi;
    const pathSegment = /[\w-]+\/[\w-]+(?:\/[\w-]+)*/g;
    let m: RegExpExecArray | null;
    while ((m = pathLike.exec(request)) !== null) paths.push(m[1].trim());
    while ((m = pathSegment.exec(request)) !== null) paths.push(m[0]);
    return paths.slice(0, 10);
  }

  private requiresApproval(
    requirements: RequirementsAnalysis,
    context: GenerationContext,
  ): boolean {
    if (requirements.riskLevel === 'high') {
      return true;
    }
    const estimatedLOC = this.estimateLOC(requirements, context);
    if (estimatedLOC > LOC_THRESHOLD_REQUIRES_APPROVAL) {
      return true;
    }
    const lowerRequest = context.userRequest.toLowerCase();
    const securityKeywords = [
      'auth',
      'security',
      'password',
      'token',
      'secret',
      'api key',
      'credential',
    ];
    if (securityKeywords.some((k) => lowerRequest.includes(k))) {
      return true;
    }
    return false;
  }

  private estimateLOC(
    requirements: RequirementsAnalysis,
    context: GenerationContext,
  ): number {
    const estimates: Record<string, number> = {
      test: 50,
      boilerplate: 100,
      refactor: 150,
      docs: 20,
      patch: 80,
      other: 100,
    };
    const baseEstimate = estimates[requirements.generationType] ?? 100;

    const scopeMultipliers: Record<string, number> = {
      function: 0.3,
      file: 1.0,
      module: 3.0,
      repository: 10.0,
    };
    const multiplier = scopeMultipliers[requirements.scope] ?? 1.0;

    let complexityMultiplier = 1.0;
    if (context.existingCode && Object.keys(context.existingCode).length > 0) {
      const totalLines = Object.values(context.existingCode).reduce(
        (sum, content) => sum + content.split('\n').length,
        0,
      );
      if (totalLines >= VERY_LARGE_CODEBASE_LINES) {
        complexityMultiplier = 1.3;
      } else if (totalLines >= LARGE_CODEBASE_LINES) {
        complexityMultiplier = 1.15;
      }
    }

    if (context.repoContext?.framework) {
      complexityMultiplier *= 1.1;
    }

    const maxLOC = requirements.intent?.constraints?.maxLOC;
    const raw = Math.ceil(baseEstimate * multiplier * complexityMultiplier);
    return maxLOC != null && maxLOC > 0 ? Math.min(raw, maxLOC) : raw;
  }

  private checkPrerequisites(
    requirements: RequirementsAnalysis,
    context: GenerationContext,
    language: string,
  ): string[] {
    const prerequisites: string[] = [];

    if (
      requirements.detectedLanguage &&
      !this.languagePrioritizerService.isLanguageSupported(
        requirements.detectedLanguage,
      )
    ) {
      prerequisites.push(
        `Language ${requirements.detectedLanguage} may not be fully supported.`,
      );
    }

    const lowerRequest = context.userRequest.toLowerCase();

    if (
      lowerRequest.includes('database') &&
      !context.repoContext?.packageManager
    ) {
      prerequisites.push('Database dependencies may need to be configured.');
    }

    if (
      (lowerRequest.includes('api') ||
        lowerRequest.includes('endpoint') ||
        lowerRequest.includes('http')) &&
      !context.repoContext?.framework
    ) {
      prerequisites.push(
        'API or HTTP usage detected; ensure a web framework is configured.',
      );
    }

    if (requirements.generationType === 'test' && language) {
      const testFrameworks = ['jest', 'vitest', 'mocha', 'pytest', 'junit'];
      const hasTestHint = testFrameworks.some((f) => lowerRequest.includes(f));
      if (!hasTestHint && !context.repoContext?.framework) {
        prerequisites.push(
          'Test generation may require a test framework (e.g. Jest, Vitest, Pytest).',
        );
      }
    }

    if (
      requirements.intent?.constraints?.styleGuide &&
      !context.repoContext?.framework
    ) {
      prerequisites.push(
        `Style guide "${requirements.intent.constraints.styleGuide}" may require corresponding tooling.`,
      );
    }

    return prerequisites;
  }

  /**
   * Select templates by generation type, language, and repo framework.
   */
  private selectTemplates(
    requirements: RequirementsAnalysis,
    language: string,
    repoContext?: GenerationContext['repoContext'],
  ): string[] {
    const templates: string[] = [];
    const base = `${requirements.generationType}_${language}`;
    templates.push(base);

    const framework = repoContext?.framework?.toLowerCase();
    if (framework) {
      const normalized = framework.replace(/\s+/g, '');
      for (const [key, templateList] of Object.entries(TEMPLATE_BY_FRAMEWORK)) {
        if (normalized.includes(key)) {
          const relevant = templateList.filter(
            (t) =>
              (requirements.generationType === 'test' &&
                t.startsWith('test_')) ||
              (requirements.generationType === 'boilerplate' &&
                !t.startsWith('test_')) ||
              t.includes(requirements.generationType),
          );
          templates.push(...relevant);
        }
      }
    }

    // Fallbacks by type
    if (requirements.generationType === 'test') {
      if (language === 'typescript' || language === 'javascript') {
        templates.push('test_jest_typescript', 'test_vitest_typescript');
      }
      if (language === 'python') {
        templates.push('test_pytest', 'test_pytest_fixture');
      }
    }

    if (requirements.generationType === 'boilerplate') {
      templates.push(`boilerplate_${language}_default`);
    }

    return [...new Set(templates)];
  }
}
