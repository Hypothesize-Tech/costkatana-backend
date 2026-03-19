import { Injectable, Logger } from '@nestjs/common';
import { WebSearchToolService } from '../../utils/services/web-search.tool.service';
import { BedrockService } from '../../bedrock/bedrock.service';
import type { UseCaseBenchmark } from '../dto/roi-result.dto';

const DEFAULT_BENCHMARK: UseCaseBenchmark = {
  useCaseName: '',
  efficiencyGainPercent: 25,
  costReductionPercent: 20,
  implementationTimeWeeks: 12,
  sources: [],
};

/**
 * Fetches live ROI benchmarks via web search and LLM extraction.
 * Falls back to conservative defaults if search or extraction fails.
 */
@Injectable()
export class BenchmarkFetcherService {
  private readonly logger = new Logger(BenchmarkFetcherService.name);

  constructor(private readonly webSearch: WebSearchToolService) {}

  /**
   * Fetch benchmarks for each use case. Searches the web and uses LLM to extract
   * efficiency gain %, cost reduction %, and implementation time.
   */
  async fetchBenchmarks(
    useCaseNames: string[],
    industry: string,
  ): Promise<UseCaseBenchmark[]> {
    const results: UseCaseBenchmark[] = [];

    for (const name of useCaseNames) {
      try {
        const bench = await this.fetchBenchmarkForUseCase(name, industry);
        results.push(bench);
      } catch (error) {
        this.logger.warn(`Benchmark fetch failed for "${name}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          ...DEFAULT_BENCHMARK,
          useCaseName: name,
        });
      }
    }

    return results;
  }

  private async fetchBenchmarkForUseCase(
    useCaseName: string,
    industry: string,
  ): Promise<UseCaseBenchmark> {
    const query = `AI ROI ${useCaseName} ${industry} 2025 case study benchmark efficiency savings`;
    const searchInput = JSON.stringify({
      operation: 'search',
      query,
      options: { maxResults: 8 },
    });

    const rawResult = await this.webSearch.call(searchInput);
    const parsed = JSON.parse(rawResult) as {
      success?: boolean;
      data?: {
        searchResults?: Array<{ title: string; snippet: string; url: string }>;
        extractedText?: string;
      };
      error?: string;
    };

    if (!parsed.success || !parsed.data?.searchResults?.length) {
      return {
        ...DEFAULT_BENCHMARK,
        useCaseName,
      };
    }

    const snippets = parsed.data.searchResults
      .map((r) => `${r.title}\n${r.snippet}`)
      .join('\n\n');
    const sources = parsed.data.searchResults.map((r) => ({
      title: r.title,
      url: r.url,
    }));

    const extracted = await this.extractBenchmarksWithLLM(
      useCaseName,
      industry,
      snippets,
    );
    return {
      useCaseName,
      efficiencyGainPercent:
        extracted.efficiencyGainPercent ??
        DEFAULT_BENCHMARK.efficiencyGainPercent,
      costReductionPercent:
        extracted.costReductionPercent ??
        DEFAULT_BENCHMARK.costReductionPercent,
      implementationTimeWeeks:
        extracted.implementationTimeWeeks ??
        DEFAULT_BENCHMARK.implementationTimeWeeks,
      sources,
    };
  }

  private async extractBenchmarksWithLLM(
    useCaseName: string,
    industry: string,
    snippets: string,
  ): Promise<{
    efficiencyGainPercent?: number;
    costReductionPercent?: number;
    implementationTimeWeeks?: number;
  }> {
    const prompt = `You are a research analyst. Extract AI adoption benchmarks from the following web search results.

Use case: ${useCaseName}
Industry: ${industry}

Search results:
${snippets.substring(0, 4000)}

Return ONLY a valid JSON object with these exact keys (numbers only):
{
  "efficiencyGainPercent": <number 10-50, typical productivity/efficiency improvement %>,
  "costReductionPercent": <number 10-60, typical cost reduction %>,
  "implementationTimeWeeks": <number 4-24, typical implementation duration in weeks>
}

Use conservative, industry-typical values if the search results don't specify. Output nothing else.`;

    try {
      const response = await BedrockService.invokeModel(
        prompt,
        'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
      );
      const cleaned = await BedrockService.extractJson(response);
      const obj = JSON.parse(cleaned) as Record<string, unknown>;
      return {
        efficiencyGainPercent: this.clamp(
          Number(obj.efficiencyGainPercent),
          10,
          50,
        ),
        costReductionPercent: this.clamp(
          Number(obj.costReductionPercent),
          10,
          60,
        ),
        implementationTimeWeeks: this.clamp(
          Number(obj.implementationTimeWeeks),
          4,
          24,
        ),
      };
    } catch (error) {
      this.logger.warn('LLM benchmark extraction failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  private clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return min;
    return Math.max(min, Math.min(max, value));
  }
}
