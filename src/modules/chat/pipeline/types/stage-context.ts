/**
 * Mutable, request-scoped state threaded through the chat pipeline.
 *
 * Each stage receives the same `StageContext` and reports back a
 * `StageResult` describing what it mutated and (optionally) how to roll it
 * back. The orchestrator merges mutations into the context and records the
 * rollback for later inverse-order replay if a downstream stage fails.
 *
 * Treat this object as **append-only within a stage**: stages should add /
 * extend fields, not delete them, so subsequent stages can rely on what
 * earlier stages produced.
 */
import type { Request } from 'express';
import type { Document, Types } from 'mongoose';
import type { SendMessageDto } from '../../dto/send-message.dto';
import type { ParsedMention } from '../../interceptors/chat-mentions.interceptor';
import type { ChatMessageResponse } from '../../services/chat.service';

/**
 * Loose alias for the conversation document — the existing chat code passes
 * this around as `any` in many places. We keep the type permissive at the
 * pipeline boundary and let individual stages narrow as needed.
 */
export type ConversationDoc = Document & {
  _id: Types.ObjectId;
  userId: string;
  modelId?: string;
  title?: string;
  githubContext?: any;
  vercelContext?: any;
  mongodbContext?: any;
  currentSubject?: string;
  [key: string]: any;
};

export interface AttachmentRef {
  id?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  s3Key?: string;
  [key: string]: unknown;
}

export interface StageError {
  stage: string;
  code: string;
  message: string;
  cause?: unknown;
  retryable?: boolean;
}

/**
 * Possible high-level outcomes the pipeline can short-circuit on. A stage
 * that wants to bypass the rest of the pipeline (e.g. integration command
 * fully handled, plan needs user approval) sets this on the context and the
 * orchestrator skips remaining stages.
 */
export type ShortCircuitReason =
  | 'integration_handled'
  | 'plan_pending_approval'
  | 'cortex_streaming_handled'
  | 'mcp_early_exit';

export interface StageContext {
  /** Stable id for this request; useful for log correlation + eval persistence. */
  requestId: string;
  /** Request start ms epoch — every stage subtracts from this for duration metrics. */
  startTime: number;

  // --- inputs ---
  userId: string;
  dto: SendMessageDto;
  parsedMentions?: ParsedMention[];
  /** Express request, optional — only present on the HTTP path. */
  req?: Request;
  /** Stream chunk callback for Cortex streaming. */
  onChunk?: (chunk: string, done: boolean) => Promise<void> | void;

  // --- mutated by stages ---
  conversation?: ConversationDoc;
  recentMessages?: Array<{ role: string; content: string }>;
  /** Already-security-checked, link-enriched message body. */
  effectiveMessage?: string;
  /** The user message *before* enrichment — for storage / replay. */
  originalMessage?: string;
  /** Persisted user-message id (set by UserMessagePersistenceStage). */
  userMessageId?: string;
  /**
   * The persisted user-message Mongo document. Downstream stages and the
   * legacy `processChatRequest` body read `_id`, `createdAt`, `metadata`
   * off this — populated when the pipeline persisted it; absent in
   * non-pipeline test paths.
   */
  userMessageDoc?: any;

  attachments?: AttachmentRef[];
  attachmentContext?: string;
  attachedDocuments?: any[];

  /** Connection-derived contexts for routing + handlers. */
  githubContext?: any;
  vercelContext?: any;
  mongodbContext?: any;

  /** Final routing decision. */
  route?: string;
  /** Top-N alternates for graceful fallback when the primary handler fails. */
  alternatives?: Array<{ route: string; confidence: number }>;

  /** When set, the orchestrator stops running stages and returns immediately. */
  shortCircuit?: {
    reason: ShortCircuitReason;
    response: ChatMessageResponse;
  };

  /** Integration intent surfaced by IntegrationStage (used by routing). */
  integrationIntent?: {
    needsIntegration: boolean;
    integrations: string[];
    confidence: number;
  };

  /** Final response object returned to the controller. */
  response?: ChatMessageResponse;

  // --- bookkeeping ---
  errors: StageError[];
  /** Stack of compensating actions; orchestrator runs these in reverse on failure. */
  rollbacks: Array<() => Promise<void>>;
}

/**
 * Helper for stages that need to register a rollback. Centralised so the
 * orchestrator's contract is enforced — never mutate `ctx.rollbacks` directly.
 */
export function pushRollback(
  ctx: StageContext,
  fn: () => Promise<void>,
): void {
  ctx.rollbacks.push(fn);
}
