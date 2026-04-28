import { Injectable, Logger } from '@nestjs/common';
import { WebSearchService } from '../services/web-search.service';
import type {
  ChatTool,
  ToolExecutionContext,
  ToolResult,
} from './tool.types';

interface WebSearchToolInput {
  query: string;
  maxResults?: number;
}

/**
 * `web_search` tool — lets Claude fetch live web results when its training
 * knowledge is stale. Wraps the existing WebSearchService (Google CSE) so we
 * don't duplicate quota/caching logic.
 */
@Injectable()
export class WebSearchTool implements ChatTool<WebSearchToolInput> {
  private readonly logger = new Logger(WebSearchTool.name);

  readonly name = 'web_search';
  readonly description =
    'Search the public web for fresh information the assistant does not know. ' +
    'Use when the question involves recent events, current prices or versions, ' +
    'or any topic after your training cut-off. Returns a numbered list of ' +
    'results with titles, snippets, and source URLs that you must cite.';

  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string' as const,
        description:
          'Concise search query (3–10 words). Prefer specific nouns and a year when relevant.',
      },
      maxResults: {
        type: 'number' as const,
        description: 'How many results to return. Defaults to 5, max 10.',
      },
    },
    required: ['query'],
  };

  constructor(private readonly webSearchService: WebSearchService) {}

  async execute(
    input: WebSearchToolInput,
    _ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const query = (input?.query ?? '').trim();
    if (!query) {
      return {
        content: 'Error: empty query. Please provide a search query.',
      };
    }
    const maxResults = Math.max(
      1,
      Math.min(10, Number(input?.maxResults) || 5),
    );

    try {
      const result = await this.webSearchService.executeWebSearch({
        operation: 'search',
        query,
        options: { maxResults, deepContent: false },
        cache: { enabled: true },
      });

      const results = result.data?.searchResults ?? [];
      if (!results.length) {
        return {
          content: `No web results found for "${query}".`,
          sources: [],
        };
      }

      const lines: string[] = [];
      const sources = results.map((r, i) => {
        const idx = i + 1;
        const snippet = (r.snippet || '').replace(/\s+/g, ' ').trim();
        const displayUrl =
          r.displayUrl || (() => {
            try {
              return new URL(r.url).hostname.replace(/^www\./, '');
            } catch {
              return r.url;
            }
          })();
        lines.push(
          `[${idx}] ${r.title}\n    ${snippet}\n    Source: ${displayUrl} — ${r.url}`,
        );
        return {
          title: r.title,
          url: r.url,
          description: snippet.slice(0, 240),
        };
      });

      return {
        content:
          `Web search results for "${query}" (top ${results.length}):\n\n` +
          lines.join('\n\n') +
          '\n\nCite sources inline using markdown links when you use them in your answer.',
        sources,
        data: {
          query,
          resultCount: results.length,
          quotaUsed: result.data?.metadata?.quotaUsed,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('web_search tool execution failed', { query, message });
      return {
        content: `Web search failed for "${query}": ${message}. Answer from general knowledge and note that live data is unavailable.`,
      };
    }
  }
}
