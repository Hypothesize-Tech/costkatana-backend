/**
 * Citation Response Parser
 *
 * Walks the Anthropic Messages-API response `content[]` array, extracts any
 * `citations[]` attached to text blocks, resolves each citation's
 * `document_index` through the `CitationSourceIndex` produced at request time,
 * and returns a flat citation list that the chat service persists and streams
 * to the frontend.
 *
 * Input shape (Anthropic wire format):
 *
 *   {
 *     content: [
 *       { type: "text", text: "...", citations: [
 *           { type: "char_location" | "page_location" | "content_block_location",
 *             cited_text: "...",
 *             document_index: 0,
 *             document_title: "earth.pdf",
 *             start_page_number?: 3,
 *             end_page_number?: 3,
 *             start_char_index?: 12,
 *             end_char_index?: 98,
 *             start_block_index?: 0,
 *             end_block_index?: 0
 *           }
 *       ] }
 *     ]
 *   }
 */

import type { CitationSourceIndex } from './citable-document-builder';
import type { IMessageCitation } from '../../../schemas/chat/chat-message.schema';

type RawCitation = {
  type?: string;
  cited_text?: string;
  document_index?: number;
  document_title?: string;
  start_page_number?: number;
  end_page_number?: number;
  start_char_index?: number;
  end_char_index?: number;
  start_block_index?: number;
  end_block_index?: number;
};

type RawContentBlock = {
  type?: string;
  text?: string;
  citations?: RawCitation[];
};

export interface ParseCitationsInput {
  content: unknown;
  index: CitationSourceIndex;
}

export interface ParseCitationsOutput {
  citations: IMessageCitation[];
  /** Flat assembled text — the same string the UI renders. Offsets in each
   *  citation are relative to its own `textBlockIndex`, NOT to this string. */
  text: string;
}

export function parseCitationsFromResponse(
  input: ParseCitationsInput,
): ParseCitationsOutput {
  const blocks = Array.isArray(input.content) ? (input.content as RawContentBlock[]) : [];
  const citations: IMessageCitation[] = [];
  const textParts: string[] = [];
  let citCounter = 0;
  let textBlockIndex = 0;

  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    textParts.push(block.text);

    const raw = Array.isArray(block.citations) ? block.citations : [];
    for (const c of raw) {
      const resolved = resolveCitation(c, input.index, textBlockIndex, citCounter);
      if (resolved) {
        citations.push(resolved);
        citCounter += 1;
      }
    }

    textBlockIndex += 1;
  }

  return { citations, text: textParts.join('') };
}

function resolveCitation(
  c: RawCitation,
  index: CitationSourceIndex,
  textBlockIndex: number,
  n: number,
): IMessageCitation | null {
  if (typeof c?.document_index !== 'number') return null;
  const src = index.get(c.document_index);

  const title =
    src?.title ??
    c.document_title ??
    `Document ${c.document_index}`;

  const location = toLocation(c);
  if (!location) return null;

  const citedText = typeof c.cited_text === 'string' ? c.cited_text : '';

  const doc: IMessageCitation['document'] = {
    index: c.document_index,
    documentId: src?.documentId,
    title,
    url: src?.url,
    sourceType: src?.sourceType ?? 'upload',
  };

  const offsets = toBlockOffsets(c, citedText);

  return {
    id: `cit_${n + 1}`,
    textBlockIndex,
    startOffset: offsets.start,
    endOffset: offsets.end,
    citedText,
    document: doc,
    location,
  };
}

function toLocation(c: RawCitation): IMessageCitation['location'] | null {
  if (typeof c.start_page_number === 'number' && typeof c.end_page_number === 'number') {
    return { type: 'page', start: c.start_page_number, end: c.end_page_number };
  }
  if (typeof c.start_char_index === 'number' && typeof c.end_char_index === 'number') {
    return { type: 'char', start: c.start_char_index, end: c.end_char_index };
  }
  if (typeof c.start_block_index === 'number' && typeof c.end_block_index === 'number') {
    return { type: 'chunk', start: c.start_block_index, end: c.end_block_index };
  }
  return null;
}

/**
 * Anthropic does not return the offset of the *citing* span inside the
 * assistant's own text — it returns the offset of the *cited* span inside the
 * source document. For inline-marker injection we need the former. We compute
 * it by suffix-matching `cited_text` within the assistant's current text
 * block: the marker is placed at the end of the last such occurrence. If the
 * text can't be matched (Claude paraphrased), the caller appends the marker
 * at the block's end as a fallback.
 */
function toBlockOffsets(
  c: RawCitation,
  citedText: string,
): { start: number; end: number } {
  // We return -1/-1 as "unresolved"; the frontend injector treats that as
  // "append at end of text block".
  return { start: -1, end: -1 };
}

/**
 * Resolve inline offsets against the actual assistant text. Called by the
 * service after the full text is known (streaming or not). Mutates citations
 * to replace -1/-1 sentinels with real offsets when the cited_text is found
 * verbatim in the text block; otherwise leaves them at -1/-1 for the
 * frontend's end-of-block fallback behavior.
 */
export function resolveInlineOffsets(
  citations: IMessageCitation[],
  blockTexts: string[],
): void {
  // Track last match cursor per block so multiple citations of the same
  // cited_text land at distinct positions.
  const cursors = new Map<number, number>();
  for (const cit of citations) {
    if (cit.startOffset >= 0) continue;
    const text = blockTexts[cit.textBlockIndex];
    if (typeof text !== 'string' || !cit.citedText) continue;
    const from = cursors.get(cit.textBlockIndex) ?? 0;
    const idx = text.indexOf(cit.citedText, from);
    if (idx >= 0) {
      cit.startOffset = idx;
      cit.endOffset = idx + cit.citedText.length;
      cursors.set(cit.textBlockIndex, cit.endOffset);
    } else {
      cit.startOffset = text.length;
      cit.endOffset = text.length;
    }
  }
}
