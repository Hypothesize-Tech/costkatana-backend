/**
 * Structured Query Detector Service
 * Lightweight regex/keyword-based detection for precision-first cost/usage queries.
 * No LLM calls — sub-millisecond overhead for routing structured vs semantic retrieval.
 *
 * Query types:
 * - cost_filter: "GPT-4o costs over $0.05 last week"
 * - model_comparison: "Compare claude-3 vs gpt-4o costs"
 * - time_range: "Usage in March", "last week spending"
 * - token_analysis: "Models with more than 1000 tokens"
 * - semantic: Fallback when no structured patterns match
 */

import { Injectable, Logger } from '@nestjs/common';

export type StructuredQueryType =
  | 'cost_filter'
  | 'model_comparison'
  | 'time_range'
  | 'token_analysis'
  | 'semantic';

export interface ParsedQueryParams {
  models?: string[];
  providers?: string[];
  costThreshold?: number;
  costOperator?: 'gt' | 'gte' | 'lt' | 'lte';
  tokenThreshold?: number;
  tokenOperator?: 'gt' | 'gte' | 'lt' | 'lte';
  startDate?: Date;
  endDate?: Date;
  timeRange?: string;
  rawQuery: string;
}

export interface StructuredQueryDetection {
  isStructured: boolean;
  queryType: StructuredQueryType;
  confidence: number;
  extractedParams: ParsedQueryParams;
  reasoning?: string[];
}

/** Known model name patterns (case-insensitive) */
const MODEL_PATTERNS = [
  /\b(gpt-4o|gpt-4|gpt-3\.5|gpt-3)\b/i,
  /\b(claude-3[- ]?5|claude-3[- ]?opus|claude-3[- ]?sonnet|claude-3)\b/i,
  /\b(gemini[- ]?pro|gemini[- ]?1\.5)\b/i,
  /\b(llama-3|llama-2|mistral)\b/i,
  /\b(titan-embed|nova-micro|nova-lite)\b/i,
];

/** Cost/spend keywords */
const COST_KEYWORDS = [
  'cost',
  'costs',
  'spend',
  'spending',
  'expense',
  'price',
  'pricing',
  'bill',
  'exceeded',
  'over',
  'under',
  'above',
  'below',
  'cheaper',
  'expensive',
];

/** Time range keywords and patterns */
const TIME_PATTERNS: Array<{ regex: RegExp; parser: (m: RegExpMatchArray) => { start: Date; end: Date } }> = [
  {
    regex: /\blast\s+week\b/i,
    parser: () => {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 7);
      return { start, end };
    },
  },
  {
    regex: /\blast\s+month\b/i,
    parser: () => {
      const end = new Date();
      const start = new Date(end);
      start.setMonth(start.getMonth() - 1);
      return { start, end };
    },
  },
  {
    regex: /\bthis\s+month\b/i,
    parser: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end: now };
    },
  },
  {
    regex: /\bthis\s+week\b/i,
    parser: () => {
      const now = new Date();
      const day = now.getDay();
      const start = new Date(now);
      start.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    },
  },
  {
    regex: /\byesterday\b/i,
    parser: () => {
      const end = new Date();
      end.setHours(0, 0, 0, 0);
      const start = new Date(end);
      start.setDate(start.getDate() - 1);
      return { start, end };
    },
  },
  {
    regex: /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    parser: (m) => {
      const months: Record<string, number> = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      };
      const monthName = m[1].toLowerCase();
      const month = months[monthName] ?? 0;
      const year = new Date().getFullYear();
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
      return { start, end };
    },
  },
];

/** Cost threshold: e.g. $0.05, over 0.05, more than 5 cents */
const COST_THRESHOLD_REGEX = /\$?\s*(\d+\.?\d*)\s*(cents?|dollars?|usd)?/i;
const COST_OPERATOR_REGEX = /\b(over|above|more than|exceeded?|greater than)\b/i;
const COST_OPERATOR_LOW_REGEX = /\b(under|below|less than)\b/i;

/** Token threshold */
const TOKEN_THRESHOLD_REGEX = /\b(\d{1,})\s*(tokens?|t)\b/i;
const TOKEN_OPERATOR_REGEX = /\b(more than|over|above|greater than)\b/i;
const TOKEN_OPERATOR_LOW_REGEX = /\b(less than|under|below)\b/i;

/** Comparison keywords */
const COMPARISON_KEYWORDS = ['compare', 'comparison', 'vs', 'versus', 'vs.', 'difference between'];

@Injectable()
export class StructuredQueryDetectorService {
  private readonly logger = new Logger(StructuredQueryDetectorService.name);

  /**
   * Detect if a query is structured (precision-first) or semantic.
   * Uses regex + keyword matching only — no LLM, <1ms.
   */
  detect(query: string): StructuredQueryDetection {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        isStructured: false,
        queryType: 'semantic',
        confidence: 0,
        extractedParams: { rawQuery: trimmed },
      };
    }

    const lower = trimmed.toLowerCase();
    const params: ParsedQueryParams = { rawQuery: trimmed };
    const reasoning: string[] = [];
    let score = 0;
    let queryType: StructuredQueryType = 'semantic';

    // Check for model names
    const hasModels = MODEL_PATTERNS.some((re) => re.test(trimmed));
    if (hasModels) {
      score += 0.3;
      reasoning.push('Model name(s) detected');
      params.models = this.extractModelNames(trimmed);
    }

    // Check for cost keywords
    const hasCostKeywords = COST_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasCostKeywords) {
      score += 0.25;
      reasoning.push('Cost/spend keywords detected');
    }

    // Check for time range
    const timeMatch = TIME_PATTERNS.find(({ regex }) => regex.test(trimmed));
    if (timeMatch) {
      score += 0.25;
      reasoning.push('Time range detected');
      const { start, end } = timeMatch.parser(trimmed.match(timeMatch.regex)!);
      params.startDate = start;
      params.endDate = end;
      params.timeRange = timeMatch.regex.source;
    }

    // Check for cost threshold
    const costMatch = trimmed.match(COST_THRESHOLD_REGEX);
    const hasCostOp = COST_OPERATOR_REGEX.test(trimmed) || COST_OPERATOR_LOW_REGEX.test(trimmed);
    if (costMatch && (hasCostOp || lower.includes('over') || lower.includes('under'))) {
      score += 0.2;
      let value = parseFloat(costMatch[1]);
      if (lower.includes('cent')) value /= 100;
      params.costThreshold = value;
      params.costOperator = COST_OPERATOR_LOW_REGEX.test(trimmed) ? 'lt' : 'gt';
      reasoning.push(`Cost threshold: ${params.costOperator} ${value}`);
    }

    // Check for token threshold
    const tokenMatch = trimmed.match(TOKEN_THRESHOLD_REGEX);
    const hasTokenOp = TOKEN_OPERATOR_REGEX.test(trimmed) || TOKEN_OPERATOR_LOW_REGEX.test(trimmed);
    if (tokenMatch && hasTokenOp) {
      score += 0.2;
      params.tokenThreshold = parseInt(tokenMatch[1], 10);
      params.tokenOperator = TOKEN_OPERATOR_LOW_REGEX.test(trimmed) ? 'lt' : 'gt';
      reasoning.push(`Token threshold: ${params.tokenOperator} ${params.tokenThreshold}`);
    }

    // Check for comparison (model_comparison)
    const hasComparison = COMPARISON_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasComparison && (hasModels || hasCostKeywords)) {
      queryType = 'model_comparison';
      score += 0.15;
      reasoning.push('Comparison intent detected');
    } else if (params.costThreshold !== undefined && hasModels) {
      queryType = 'cost_filter';
    } else if (params.tokenThreshold !== undefined) {
      queryType = 'token_analysis';
    } else if (timeMatch && hasCostKeywords) {
      queryType = 'time_range';
    }

    const isStructured = score >= 0.5;
    const confidence = Math.min(1, score);

    if (isStructured) {
      this.logger.debug('Structured query detected', {
        queryType,
        confidence: confidence.toFixed(2),
        models: params.models,
        costThreshold: params.costThreshold,
        timeRange: params.timeRange,
      });
    }

    return {
      isStructured,
      queryType: isStructured ? queryType : 'semantic',
      confidence,
      extractedParams: params,
      reasoning: reasoning.length > 0 ? reasoning : undefined,
    };
  }

  private extractModelNames(query: string): string[] {
    const names: string[] = [];
    const modelNameRegex = /\b(gpt-4o|gpt-4|gpt-3\.5|gpt-3|claude-3[- ]?5|claude-3[- ]?opus|claude-3[- ]?sonnet|claude-3|gemini[- ]?pro|gemini[- ]?1\.5|llama-3|llama-2|mistral|titan-embed|nova-micro|nova-lite)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = modelNameRegex.exec(query)) !== null) {
      const name = m[1].toLowerCase();
      if (!names.includes(name)) names.push(name);
    }
    return names;
  }
}
