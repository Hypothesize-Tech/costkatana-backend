/**
 * Integration Agent Types
 * 
 * Type definitions for the AI-powered Integration Agent that handles
 * parameter extraction, validation, and interactive selection UI.
 */

/**
 * Selection option for interactive parameter selection
 */
export interface SelectionOption {
  /** Unique identifier for the option */
  id: string;
  /** Display text shown to the user */
  label: string;
  /** Actual value to use when selected */
  value: string;
  /** Optional subtitle/description */
  description?: string;
  /** Optional icon name for visual enhancement */
  icon?: string;
  /** Optional metadata for additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Selection data when the agent needs user input for missing parameters
 */
export interface IntegrationSelection {
  /** The parameter name that needs to be filled (e.g., "projectName") */
  parameterName: string;
  /** Human-readable question to ask the user */
  question: string;
  /** Predefined options fetched from the integration */
  options: SelectionOption[];
  /** Whether to show "Other" input for custom values */
  allowCustom: boolean;
  /** Placeholder text for custom input */
  customPlaceholder?: string;
  /** The integration type (e.g., "vercel", "slack") */
  integration: string;
  /** The action that's pending execution */
  pendingAction: string;
  /** Parameters that have already been collected */
  collectedParams: Record<string, unknown>;
  /** Original message from the user */
  originalMessage?: string;
}

/**
 * Response from the Integration Agent
 */
export interface IntegrationAgentResponse {
  /** Whether the operation was successful */
  success: boolean;
  /** Human-readable message about the result */
  message: string;
  /** Data returned from the integration (on success) */
  data?: Record<string, unknown>;
  /** Error message if operation failed */
  error?: string;
  
  /** Whether the agent needs user selection for missing params */
  requiresSelection?: boolean;
  /** Selection data for interactive UI */
  selection?: IntegrationSelection;
  
  /** Metadata about the operation */
  metadata?: {
    integration: string;
    action: string;
    executionTimeMs?: number;
    modelUsed?: string;
  };
}

/**
 * Request to process an integration command
 */
export interface IntegrationAgentRequest {
  /** The user's message containing the integration command */
  message: string;
  /** The detected integration type */
  integration: string;
  /** User ID for fetching connection credentials */
  userId: string;
  /** Previous selection response if user clicked an option */
  selectionResponse?: {
    parameterName: string;
    value: string | number | boolean;
    pendingAction: string;
    collectedParams: Record<string, unknown>;
  };
}

/**
 * Supported integration types
 */
export type IntegrationType = 
  | 'vercel'
  | 'gmail'
  | 'slack'
  | 'discord'
  | 'jira'
  | 'linear'
  | 'github'
  | 'drive'
  | 'sheets'
  | 'gdocs'
  | 'calendar'
  | 'google';

/**
 * Action types for each integration
 */
export interface IntegrationActions {
  vercel: 
    | 'list_projects'
    | 'list_deployments'
    | 'get_logs'
    | 'list_domains'
    | 'list_env'
    | 'set_env'
    | 'deploy'
    | 'rollback'
    | 'get_project';
  
  gmail:
    | 'send'
    | 'list'
    | 'search';
  
  slack:
    | 'send_message'
    | 'list_channels'
    | 'list_users'
    | 'create_channel';
  
  discord:
    | 'send_message'
    | 'list_channels'
    | 'list_users'
    | 'ban_user'
    | 'kick_user'
    | 'create_channel';
  
  jira:
    | 'create_issue'
    | 'list_issues'
    | 'get_issue'
    | 'update_issue'
    | 'add_comment'
    | 'list_projects';
  
  linear:
    | 'create_issue'
    | 'list_issues'
    | 'get_issue'
    | 'update_issue'
    | 'list_teams'
    | 'list_projects';
  
  github:
    | 'list_repos'
    | 'create_issue'
    | 'list_issues'
    | 'create_pr'
    | 'list_prs'
    | 'list_branches'
    | 'create_branch';
  
  drive:
    | 'list'
    | 'search'
    | 'upload'
    | 'create_folder'
    | 'share';
  
  sheets:
    | 'list'
    | 'export';
  
  gdocs:
    | 'list'
    | 'read'
    | 'create';
  
  calendar:
    | 'list'
    | 'create'
    | 'update'
    | 'delete';
}

/**
 * Parameter metadata for generating questions
 */
export interface ParameterMetadata {
  /** Parameter name */
  name: string;
  /** Human-readable label */
  label: string;
  /** Description for the AI */
  description: string;
  /** Whether this parameter is required */
  required: boolean;
  /** Type of the parameter */
  type: 'string' | 'number' | 'boolean' | 'array' | 'email' | 'date';
  /** Placeholder for custom input */
  placeholder?: string;
  /** Question template to ask user */
  questionTemplate?: string;
  /** Whether options can be fetched from API */
  hasOptions?: boolean;
}

/**
 * Schema definition for an integration action
 */
export interface IntegrationActionSchema {
  /** Action name */
  action: string;
  /** Human-readable action description */
  description: string;
  /** Parameters for this action */
  parameters: ParameterMetadata[];
  /** Example messages that trigger this action */
  examples?: string[];
}

/**
 * Complete schema for an integration
 */
export interface IntegrationSchema {
  /** Integration type */
  integration: IntegrationType;
  /** Display name */
  displayName: string;
  /** Icon name */
  icon?: string;
  /** All actions supported by this integration */
  actions: Record<string, IntegrationActionSchema>;
}
