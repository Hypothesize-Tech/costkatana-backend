import { ParsedMention } from './parsed-mention.interface';

export interface IntegrationCommand {
  action: string; // 'create', 'get', 'list', 'update', 'delete', 'send', etc.
  integration: string; // 'jira', 'linear', 'slack', 'discord', 'github', etc.
  entityType: string; // 'project', 'issue', 'team', 'channel', etc.
  entityId?: string; // ID/key of the target entity
  parameters: Record<string, any>; // Action-specific parameters
  mentions: ParsedMention[]; // Original mentions that led to this command
  naturalLanguage: string; // Original message text
}

export interface IntegrationCommandResult {
  success: boolean;
  data?: any; // Result data from the integration operation
  error?: string; // Error message if failed
  auditLog?: {
    integration: string;
    action: string;
    entityType: string;
    entityId?: string;
    parameters: Record<string, any>;
    timestamp: Date;
    duration: number;
    success: boolean;
    errorDetails?: any;
  };
  message?: string; // Human-readable result message
}
