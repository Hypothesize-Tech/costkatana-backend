/**
 * Citable Document Builder
 *
 * Converts user attachments, user-selected document IDs, and RAG-retrieved
 * chunks into Anthropic Messages-API `document` content blocks with
 * `citations.enabled: true`. Returns a `CitationSourceIndex` that maps each
 * block's `document_index` back to the user-facing source metadata so the
 * response path can resolve Claude's citations into something the frontend
 * can render (titles, URLs, documentIds).
 *
 * Wire format reference (Anthropic Messages API):
 *   { type: "document",
 *     source: { type: "base64" | "text" | "content", ... },
 *     title: "...",
 *     citations: { enabled: true } }
 *
 * The same wire format is accepted by both `api.anthropic.com` and Bedrock's
 * InvokeModel for Claude 3.5+ (with anthropic_version "bedrock-2023-05-31").
 */

import type { ProcessedAttachment } from './attachment-processor';

/** A RAG retrieval chunk that can be reassembled into a citable block. */
export interface RagChunkInput {
  documentId: string;
  title: string;
  url?: string;
  text: string;
  /** Optional chunk ordinal within the parent document — used for location ranges. */
  chunkIndex?: number;
}

/** A user-selected Document row already fetched from the DB. */
export interface DocumentRefInput {
  documentId: string;
  title: string;
  url?: string;
  text: string;
  mediaType?: 'text/plain' | 'application/pdf';
}

export interface CitableDocumentBuilderInput {
  attachments?: ProcessedAttachment[];
  documents?: DocumentRefInput[];
  ragChunks?: RagChunkInput[];
}

/** Anthropic-wire-format `document` content block. Kept loose on purpose
 *  so we don't have to depend on the SDK just for a type. */
export interface DocumentContentBlock {
  type: 'document';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'text'; media_type: 'text/plain'; data: string }
    | { type: 'content'; content: Array<{ type: 'text'; text: string }> };
  title: string;
  context?: string;
  citations: { enabled: true };
}

export type CitationSourceType = 'attachment' | 'upload' | 'rag';

export interface CitationSource {
  /** Stable index matching Claude's `document_index` in the response. */
  index: number;
  documentId?: string;
  title: string;
  url?: string;
  sourceType: CitationSourceType;
  /** Optional chunk ordinal (RAG path) for downstream location rendering. */
  chunkIndex?: number;
}

export type CitationSourceIndex = Map<number, CitationSource>;

export interface CitableDocumentBuilderOutput {
  blocks: DocumentContentBlock[];
  index: CitationSourceIndex;
  /** Debug/telemetry counters. */
  stats: {
    fromAttachments: number;
    fromDocuments: number;
    fromRagChunks: number;
    totalBytes: number;
    skipped: number;
  };
}

/** Per-request payload ceiling for citable docs — guards against Bedrock/HTTP
 *  body limits when users attach very large PDFs. When exceeded, later blocks
 *  fall back to a truncated `content` source instead of full base64. */
const MAX_TOTAL_DOC_BYTES = 30 * 1024 * 1024; // 30 MB
const MAX_TEXT_BLOCK_CHARS = 1_000_000; // ~1M char cap per block (safety)

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/xml',
  'text/html',
]);

function normalizeTextMime(mime?: string): 'text/plain' {
  return 'text/plain';
}

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_BLOCK_CHARS) return text;
  return text.slice(0, MAX_TEXT_BLOCK_CHARS);
}

/**
 * Build Anthropic `document` content blocks + a source index.
 *
 * Block ordering is deterministic: attachments → documents → ragChunks.
 * Each block's `document_index` is its position in the resulting array and is
 * what Claude echoes in `citations[].document_index`. The index map lets the
 * response parser recover `{documentId, title, url, sourceType}` for each
 * citation without having to re-query anything.
 */
export function buildCitableDocumentBlocks(
  input: CitableDocumentBuilderInput,
): CitableDocumentBuilderOutput {
  const blocks: DocumentContentBlock[] = [];
  const index: CitationSourceIndex = new Map();
  let totalBytes = 0;
  let fromAttachments = 0;
  let fromDocuments = 0;
  let fromRagChunks = 0;
  let skipped = 0;

  const pushBlock = (block: DocumentContentBlock, source: Omit<CitationSource, 'index'>, approxBytes: number) => {
    if (totalBytes + approxBytes > MAX_TOTAL_DOC_BYTES) {
      skipped += 1;
      return;
    }
    const i = blocks.length;
    blocks.push(block);
    index.set(i, { ...source, index: i });
    totalBytes += approxBytes;
  };

  for (const att of input.attachments ?? []) {
    const text = att.extractedContent?.trim();
    if (!text) {
      skipped += 1;
      continue;
    }
    const truncated = truncateText(text);
    const block: DocumentContentBlock = {
      type: 'document',
      source: TEXT_MIME_TYPES.has(att.mimeType)
        ? { type: 'text', media_type: normalizeTextMime(att.mimeType), data: truncated }
        : {
            type: 'content',
            content: [{ type: 'text', text: truncated }],
          },
      title: att.fileName || `attachment-${att.fileId}`,
      citations: { enabled: true },
    };
    pushBlock(
      block,
      {
        documentId: att.fileId,
        title: block.title,
        url: att.url,
        sourceType: 'attachment',
      },
      truncated.length,
    );
    fromAttachments += 1;
  }

  for (const doc of input.documents ?? []) {
    const text = doc.text?.trim();
    if (!text) {
      skipped += 1;
      continue;
    }
    const truncated = truncateText(text);
    const block: DocumentContentBlock = {
      type: 'document',
      source:
        doc.mediaType === 'application/pdf'
          ? { type: 'content', content: [{ type: 'text', text: truncated }] }
          : { type: 'text', media_type: 'text/plain', data: truncated },
      title: doc.title,
      citations: { enabled: true },
    };
    pushBlock(
      block,
      {
        documentId: doc.documentId,
        title: doc.title,
        url: doc.url,
        sourceType: 'upload',
      },
      truncated.length,
    );
    fromDocuments += 1;
  }

  /**
   * RAG chunks: group by `documentId` so each parent document becomes a single
   * citable block (not one block per chunk — Claude's `document_index` is
   * coarser than chunk granularity). Preserve chunk order within each block
   * by joining on double-newline.
   */
  const chunkGroups = new Map<string, RagChunkInput[]>();
  for (const chunk of input.ragChunks ?? []) {
    const key = chunk.documentId;
    const list = chunkGroups.get(key) ?? [];
    list.push(chunk);
    chunkGroups.set(key, list);
  }
  for (const [documentId, chunks] of chunkGroups) {
    chunks.sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
    const text = truncateText(chunks.map((c) => c.text).join('\n\n'));
    if (!text) {
      skipped += 1;
      continue;
    }
    const head = chunks[0];
    const block: DocumentContentBlock = {
      type: 'document',
      source: { type: 'content', content: [{ type: 'text', text }] },
      title: head.title,
      citations: { enabled: true },
    };
    pushBlock(
      block,
      {
        documentId,
        title: head.title,
        url: head.url,
        sourceType: 'rag',
        chunkIndex: head.chunkIndex,
      },
      text.length,
    );
    fromRagChunks += 1;
  }

  return {
    blocks,
    index,
    stats: {
      fromAttachments,
      fromDocuments,
      fromRagChunks,
      totalBytes,
      skipped,
    },
  };
}
