import { Injectable, Logger } from '@nestjs/common';
import { GoogleSearchService } from '../../utils/services/google-search.service';
import {
  NodeExecutor,
  NodeExecutorResult,
  RunContext,
} from './base-node-executor';

interface WebSearchConfig {
  /** Static query — overrides input.message if set. */
  query?: string;
  maxResults?: number;
  domains?: string[];
}

interface WebSearchInput {
  message?: string;
  query?: string;
}

interface WebSearchOutput {
  query: string;
  results: Array<{
    title: string;
    snippet: string;
    url: string;
  }>;
}

/**
 * Composes the existing GoogleSearchService (Google Custom Search API).
 * No new HTTP credentials needed — reuses GOOGLE_SEARCH_API_KEY +
 * GOOGLE_SEARCH_ENGINE_ID env vars already configured for the project.
 */
@Injectable()
export class WebSearchExecutor
  implements NodeExecutor<WebSearchInput, WebSearchOutput>
{
  private readonly logger = new Logger(WebSearchExecutor.name);
  readonly type = 'web-search' as const;

  constructor(private readonly google: GoogleSearchService) {}

  async execute(
    _ctx: RunContext,
    config: Record<string, unknown>,
    input: WebSearchInput,
  ): Promise<NodeExecutorResult<WebSearchOutput>> {
    const cfg = config as unknown as WebSearchConfig;
    const query = (cfg.query ?? input?.query ?? input?.message ?? '').trim();
    if (!query) {
      return {
        output: { query: '', results: [] },
        traceMeta: { skipped: 'empty_query' },
      };
    }

    try {
      const raw = await this.google.search(query, {
        maxResults: cfg.maxResults ?? 5,
        domains: cfg.domains,
      });
      const results = raw.map((r) => ({
        title: r.title,
        snippet: r.snippet,
        url: r.url,
      }));
      return {
        output: { query, results },
        traceMeta: { count: results.length, provider: 'google_cse' },
      };
    } catch (err) {
      this.logger.warn(
        `web-search failed for "${query}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        output: { query, results: [] },
        traceMeta: {
          provider: 'google_cse',
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
