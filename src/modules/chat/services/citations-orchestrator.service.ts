/**
 * Citations Orchestrator
 *
 * Thin façade that internal chat callers use when they want to send a
 * citations-enabled request to Claude. Composes the low-level pieces:
 *
 *   1. `buildCitableDocumentBlocks` — turns processed attachments / docs /
 *      RAG chunks into Anthropic `document` content blocks + a source index.
 *   2. Produces an Anthropic Messages body already primed with those blocks
 *      in the last user message.
 *   3. Hands the `CitationSourceIndex` back to the caller so the response
 *      parser can resolve each citation's `document_index` to user-facing
 *      source metadata.
 *
 * The orchestrator itself does not invoke Bedrock — callers pass the returned
 * payload into `BedrockService.invokeClaudeMessagesOnBedrock(...)` (or the
 * streaming variant) as they already do.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  buildCitableDocumentBlocks,
  type CitableDocumentBuilderInput,
  type CitationSourceIndex,
  type DocumentContentBlock,
} from '../utils/citable-document-builder';

export interface PrepareCitationsInput extends CitableDocumentBuilderInput {
  /** User's natural-language question. Placed after the document blocks. */
  userText: string;
  /** Optional earlier turns. Not enriched with document blocks — only the
   *  final user turn gets citable documents, per Anthropic guidance. */
  priorMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Defaults to 4096 when omitted; callers usually pass the model's max. */
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export interface PrepareCitationsOutput {
  /** Anthropic Messages body ready for Bedrock or direct Anthropic. */
  body: Record<string, unknown>;
  /** Map used later to resolve Claude's `document_index` in the response. */
  index: CitationSourceIndex;
  /** True when at least one document block was attached. */
  hasDocuments: boolean;
  stats: {
    documentBlocks: number;
    fromAttachments: number;
    fromDocuments: number;
    fromRagChunks: number;
    totalBytes: number;
    skipped: number;
  };
}

@Injectable()
export class CitationsOrchestratorService {
  private readonly logger = new Logger(CitationsOrchestratorService.name);

  prepare(input: PrepareCitationsInput): PrepareCitationsOutput {
    const built = buildCitableDocumentBlocks({
      attachments: input.attachments,
      documents: input.documents,
      ragChunks: input.ragChunks,
    });

    const finalUserContent: unknown[] = [
      ...built.blocks,
      { type: 'text', text: input.userText },
    ];

    const messages: Array<Record<string, unknown>> = [];
    for (const prior of input.priorMessages ?? []) {
      messages.push({ role: prior.role, content: prior.content });
    }
    // Only the last user turn gets document blocks.
    messages.push({ role: 'user', content: finalUserContent });

    const body: Record<string, unknown> = {
      messages,
      max_tokens: input.maxTokens ?? 4096,
    };
    if (typeof input.temperature === 'number') body.temperature = input.temperature;
    if (input.system) body.system = input.system;

    this.logger.debug('Prepared citations-enabled Anthropic Messages body', {
      documentBlocks: built.blocks.length,
      stats: built.stats,
      hasSystem: !!input.system,
      priorMessageCount: input.priorMessages?.length ?? 0,
    });

    return {
      body,
      index: built.index,
      hasDocuments: built.blocks.length > 0,
      stats: {
        documentBlocks: built.blocks.length,
        ...built.stats,
      },
    };
  }

  /**
   * Convenience: expose the raw block builder so callers that construct their
   * own Messages body (e.g. multi-turn tool-using flows) can still get the
   * `index` for response resolution without going through `prepare()`.
   */
  buildBlocks(input: CitableDocumentBuilderInput): {
    blocks: DocumentContentBlock[];
    index: CitationSourceIndex;
  } {
    const built = buildCitableDocumentBlocks(input);
    return { blocks: built.blocks, index: built.index };
  }
}
