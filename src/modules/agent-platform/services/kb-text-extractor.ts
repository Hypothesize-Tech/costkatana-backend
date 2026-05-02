import { Logger } from '@nestjs/common';

const logger = new Logger('KbTextExtractor');

/**
 * Extract plain text from a document buffer based on its mimetype /
 * filename. Returns the raw text — chunking happens in `chunkText` below.
 *
 * Supported types (everything else falls back to UTF-8 text decode):
 *   - PDF                                 (`pdf-parse`)
 *   - DOCX                                (`mammoth`)
 *   - HTML / TXT / MD / CSV / JSON        (decode + light cleanup)
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  mimetype?: string,
): Promise<string> {
  const lowerName = filename.toLowerCase();
  const ext = lowerName.split('.').pop() ?? '';
  const type = (mimetype ?? '').toLowerCase();

  try {
    if (type === 'application/pdf' || ext === 'pdf') {
      const pdfParse = (await import('pdf-parse')).default as (
        b: Buffer,
      ) => Promise<{ text: string }>;
      const result = await pdfParse(buffer);
      return cleanWhitespace(result.text);
    }

    if (
      type ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx'
    ) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return cleanWhitespace(result.value ?? '');
    }

    if (type === 'text/html' || ext === 'html' || ext === 'htm') {
      return cleanWhitespace(stripHtml(buffer.toString('utf8')));
    }

    if (type === 'application/json' || ext === 'json') {
      try {
        const parsed = JSON.parse(buffer.toString('utf8'));
        return cleanWhitespace(JSON.stringify(parsed, null, 2));
      } catch {
        return cleanWhitespace(buffer.toString('utf8'));
      }
    }

    // text/plain, text/markdown, text/csv, anything else — decode as UTF-8.
    return cleanWhitespace(buffer.toString('utf8'));
  } catch (err) {
    logger.warn(
      `Extraction failed for ${filename}: ${
        err instanceof Error ? err.message : String(err)
      } — falling back to UTF-8 decode.`,
    );
    return cleanWhitespace(buffer.toString('utf8'));
  }
}

/**
 * Split text into overlapping chunks. Defaults are tuned for retrieval
 * quality at Titan v2's 8k token context: ~1000 chars (~250 tokens) with
 * 200 char overlap so a question that lands on a chunk boundary still
 * surfaces full sentences.
 */
export function chunkText(
  text: string,
  options?: { size?: number; overlap?: number },
): string[] {
  const size = options?.size ?? 1000;
  const overlap = options?.overlap ?? 200;
  const cleaned = text.trim();
  if (!cleaned) return [];

  // First try splitting on paragraph + sentence boundaries; fall back to
  // hard char windowing if a single paragraph is bigger than `size`.
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buffer = '';
  for (const p of paragraphs) {
    if (buffer.length + p.length + 2 <= size) {
      buffer = buffer ? `${buffer}\n\n${p}` : p;
    } else {
      if (buffer) chunks.push(buffer);
      // Paragraph itself bigger than size — hard split with overlap.
      if (p.length > size) {
        let i = 0;
        while (i < p.length) {
          const end = Math.min(i + size, p.length);
          chunks.push(p.slice(i, end));
          if (end === p.length) break;
          i += Math.max(1, size - overlap);
        }
        buffer = '';
      } else {
        buffer = p;
      }
    }
  }
  if (buffer) chunks.push(buffer);

  // Apply overlap by sliding window over short chunks
  if (overlap > 0 && chunks.length > 1) {
    const overlapped: string[] = [chunks[0]];
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const tail = prev.slice(-overlap);
      overlapped.push(`${tail}${chunks[i]}`);
    }
    return overlapped;
  }
  return chunks;
}

function cleanWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** L2-normalize a vector in-place (pure function-style). */
export function l2Normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}
