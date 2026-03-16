/**
 * Types for Langchain Multi-Agent Orchestrator
 */

import { BaseMessage } from '@langchain/core/messages';
import { Annotation } from '@langchain/langgraph';

export interface LangchainChatStateType {
  messages: BaseMessage[];
  userId: string;
  conversationId: string;
  context?: any;
  userPreferences?: any;
  integrations?: string[];
  currentAgent?: string;
  userInputRequired?: boolean;
  userInputPrompt?: string;
  strategyFormed?: boolean;
  integrationResults?: any[];
  finalResponse?: string;
  /** User intent (e.g. from classifier) */
  userIntent?: string;
  /** Conversation/session context (conversationId, userId, etc.) */
  contextData?: Record<string, any>;
  /** Strategy formation state (adaptive questions, selections) */
  strategyFormation?: any;
  /** Collected user inputs for multi-step flows */
  userInputCollection?: Record<string, any>;
  /** Last user message content for tool/agent use */
  userMessage?: string;
  /** Integration/tool context passed to agents */
  integrationContext?: Record<string, any>;
  /** Depth of conversation for routing */
  conversationDepth?: number;
  /** Autonomous agent decisions log */
  autonomousDecisions?: any[];
  /** Feature flags / world-class features context */
  worldClassFeatures?: Record<string, any>;
  /** Proactive insights from agents */
  proactiveInsights?: any[];
  metadata?: {
    startTime: number;
    agentPath: string[];
    cost: number;
    tokens: number;
  };
}

/** Annotation-based state for StateGraph (reducers for messages, etc.) */
export const LangchainChatStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => (x ?? []).concat(y ?? []),
    default: () => [],
  }),
  userId: Annotation<string>({ reducer: (_, y) => y ?? '', default: () => '' }),
  conversationId: Annotation<string>({
    reducer: (_, y) => y ?? '',
    default: () => '',
  }),
  currentAgent: Annotation<string>({
    reducer: (_, y) => y ?? 'coordinator',
    default: () => 'coordinator',
  }),
  context: Annotation<Record<string, any>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  finalResponse: Annotation<string>({
    reducer: (_, y) => y ?? '',
    default: () => '',
  }),
  metadata: Annotation<{
    startTime?: number;
    agentPath?: string[];
    cost?: number;
    tokens?: number;
  }>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  userIntent: Annotation<string>({
    reducer: (_, y) => y ?? '',
    default: () => '',
  }),
  contextData: Annotation<Record<string, any>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  strategyFormation: Annotation<any>({
    reducer: (_, y) => y ?? undefined,
    default: () => undefined,
  }),
  userInputCollection: Annotation<Record<string, any>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  userMessage: Annotation<string>({
    reducer: (_, y) => y ?? '',
    default: () => '',
  }),
  integrationContext: Annotation<Record<string, any>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  conversationDepth: Annotation<number>({
    reducer: (_, y) => y ?? 0,
    default: () => 0,
  }),
  autonomousDecisions: Annotation<any[]>({
    reducer: (x, y) => [...(x ?? []), ...(y ?? [])],
    default: () => [],
  }),
  worldClassFeatures: Annotation<Record<string, any>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  proactiveInsights: Annotation<any[]>({
    reducer: (x, y) => [...(x ?? []), ...(y ?? [])],
    default: () => [],
  }),
  taskPriority: Annotation<number>({
    reducer: (_, y) => y ?? 5,
    default: () => 5,
  }),
});

export type LangchainChatStateGraphType =
  typeof LangchainChatStateAnnotation.State;

export interface LangchainAgentConfig {
  name: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  tools?: any[];
}

export interface UserInputSession {
  sessionId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  collectedInputs: Record<string, any>;
  requiredInputs: string[];
  createdAt: Date;
  expiresAt: Date;
  /** Optional timestamp for session tracking */
  timestamp?: Date;
  /** Optional full state snapshot */
  state?: Record<string, any>;
  /** Index of current question in strategy formation */
  questionIndex?: number;
}
