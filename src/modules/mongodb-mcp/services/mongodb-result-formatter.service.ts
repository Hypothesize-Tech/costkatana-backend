import { Injectable } from '@nestjs/common';

export interface FormatOptions {
  maxRows?: number;
  maxCellLength?: number;
  includeCount?: boolean;
}

@Injectable()
export class MongodbResultFormatterService {
  /**
   * Format a MongoDB result set for MCP text response (e.g. markdown table or JSON).
   */
  formatAsText(results: unknown[], options: FormatOptions = {}): string {
    const { maxRows = 100, maxCellLength = 200, includeCount = true } = options;
    const slice = results.slice(0, maxRows);
    if (slice.length === 0) {
      return includeCount ? 'No documents found.\n' : '';
    }
    const lines: string[] = [];
    if (includeCount) {
      lines.push(
        `Found ${results.length} document(s). Showing up to ${maxRows}.\n`,
      );
    }
    try {
      const str = JSON.stringify(slice, null, 2);
      if (maxCellLength > 0 && str.length > maxCellLength * slice.length) {
        return (
          lines.join('') +
          str.substring(0, 5000) +
          (str.length > 5000 ? '\n...' : '')
        );
      }
      return lines.join('') + str;
    } catch {
      return lines.join('') + String(slice);
    }
  }

  /**
   * Format as markdown table when documents have consistent keys.
   */
  /**
   * Format MCP tool result for chat display.
   */
  static formatForChat(result: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  }): { markdown?: string; data?: unknown } {
    const texts = (result?.content ?? [])
      .filter((c) => c?.type === 'text' && c?.text != null)
      .map((c) => (c as { text: string }).text);
    const joined = texts.join('\n');
    let data: unknown;
    try {
      data = joined ? JSON.parse(joined) : null;
    } catch {
      data = joined;
    }
    return {
      markdown: typeof data === 'string' ? data : joined,
      data,
    };
  }

  formatAsMarkdownTable(docs: Record<string, unknown>[]): string {
    if (docs.length === 0) return '';
    const keys = Array.from(new Set(docs.flatMap((d) => Object.keys(d)))).slice(
      0,
      10,
    );
    const header = '| ' + keys.join(' | ') + ' |';
    const sep = '| ' + keys.map(() => '---').join(' | ') + ' |';
    const rows = docs.slice(0, 50).map((d) => {
      const cells = keys.map((k) => {
        const v = d[k];
        const s = v == null ? '' : String(v);
        return s.length > 80 ? s.slice(0, 77) + '...' : s;
      });
      return '| ' + cells.join(' | ') + ' |';
    });
    return [header, sep, ...rows].join('\n');
  }
}
