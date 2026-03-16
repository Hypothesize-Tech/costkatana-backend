/**
 * Routing Types
 * Type definitions for routing logic and decision making
 */

export type RouteType =
  | 'web_scraper'
  | 'conversational_flow'
  | 'multi_agent'
  | 'knowledge_base'
  | 'mcp'
  | 'fallback';

export interface RouterContext {
  userId: string;
  hasVercelConnection: boolean;
  hasGithubConnection: boolean;
  hasGoogleConnection: boolean;
  conversationSubject?: string;
  messageComplexity?: 'simple' | 'complex';
  hasAttachments?: boolean;
  preferredModel?: string;
}
