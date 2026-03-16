export interface ParsedMention {
  integration: string; // 'jira', 'linear', 'slack', 'discord', 'github', 'google', 'vercel', etc.
  type?: string; // Additional type field for mentions
  entityType?: string; // 'project', 'issue', 'team', 'channel', 'repository', 'file', etc.
  entityId?: string; // ID or key of the entity
  subEntityType?: string; // Sub-entity type (e.g., 'comment', 'branch', 'deployment')
  subEntityId?: string; // ID of the sub-entity
  action?: string; // 'create', 'get', 'list', 'update', 'delete', 'send', 'add', 'assign', etc.
  parameters?: Record<string, any>; // Additional parameters specific to the integration/action
  originalMention: string; // The original @mention text
}
