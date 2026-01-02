/**
 * Integration Tools Schemas
 * 
 * Zod schemas for all integration actions with parameter validation.
 * These schemas are used by the Integration Agent to:
 * 1. Validate extracted parameters
 * 2. Identify missing required parameters
 * 3. Generate appropriate questions for missing data
 */

import { z } from 'zod';

// ============================================================================
// VERCEL SCHEMAS
// ============================================================================

export const vercelSchemas = {
  list_projects: z.object({
    action: z.literal('list_projects'),
  }).describe('List all Vercel projects'),

  list_deployments: z.object({
    action: z.literal('list_deployments'),
    projectName: z.string().min(1).describe('The Vercel project name (e.g., "costkatana-frontend")'),
  }).describe('List deployments for a specific project'),

  get_project: z.object({
    action: z.literal('get_project'),
    projectName: z.string().min(1).describe('The Vercel project name'),
  }).describe('Get details about a specific project'),

  get_logs: z.object({
    action: z.literal('get_logs'),
    projectName: z.string().min(1).describe('The Vercel project name'),
    deploymentId: z.string().optional().describe('Specific deployment ID (optional, defaults to latest)'),
  }).describe('Get deployment logs'),

  list_domains: z.object({
    action: z.literal('list_domains'),
    projectName: z.string().min(1).describe('The Vercel project name'),
  }).describe('List domains for a project'),

  add_domain: z.object({
    action: z.literal('add_domain'),
    projectName: z.string().min(1).describe('The Vercel project name'),
    domain: z.string().min(1).describe('Domain name to add (e.g., "example.com")'),
  }).describe('Add a custom domain to a project'),

  list_env: z.object({
    action: z.literal('list_env'),
    projectName: z.string().min(1).describe('The Vercel project name'),
  }).describe('List environment variables'),

  set_env: z.object({
    action: z.literal('set_env'),
    projectName: z.string().min(1).describe('The Vercel project name'),
    key: z.string().min(1).describe('Environment variable name'),
    value: z.string().min(1).describe('Environment variable value'),
    target: z.array(z.enum(['production', 'preview', 'development'])).optional()
      .describe('Target environments (defaults to all)'),
  }).describe('Set an environment variable'),

  deploy: z.object({
    action: z.literal('deploy'),
    projectName: z.string().min(1).describe('The Vercel project name'),
    target: z.enum(['production', 'preview']).optional().describe('Deployment target'),
  }).describe('Trigger a new deployment'),

  rollback: z.object({
    action: z.literal('rollback'),
    projectName: z.string().min(1).describe('The Vercel project name'),
    deploymentId: z.string().optional().describe('Deployment ID to rollback to'),
  }).describe('Rollback to a previous deployment'),
};

// ============================================================================
// GMAIL SCHEMAS
// ============================================================================

export const gmailSchemas = {
  send: z.object({
    action: z.literal('send'),
    to: z.array(z.string().email()).min(1).describe('Recipient email addresses'),
    subject: z.string().min(1).describe('Email subject line'),
    body: z.string().min(1).describe('Email body content'),
    isHtml: z.boolean().optional().describe('Whether body is HTML'),
  }).describe('Send an email'),

  list: z.object({
    action: z.literal('list'),
    query: z.string().optional().describe('Search query (e.g., "is:unread")'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  }).describe('List emails'),

  search: z.object({
    action: z.literal('search'),
    query: z.string().min(1).describe('Search query'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  }).describe('Search emails'),
};

// ============================================================================
// SLACK SCHEMAS
// ============================================================================

export const slackSchemas = {
  send_message: z.object({
    action: z.literal('send_message'),
    channelId: z.string().min(1).describe('Slack channel ID or name'),
    message: z.string().min(1).describe('Message content to send'),
  }).describe('Send a message to a Slack channel'),

  list_channels: z.object({
    action: z.literal('list_channels'),
  }).describe('List all Slack channels'),

  list_users: z.object({
    action: z.literal('list_users'),
  }).describe('List all Slack users'),

  create_channel: z.object({
    action: z.literal('create_channel'),
    name: z.string().min(1).describe('Channel name'),
    isPrivate: z.boolean().optional().describe('Whether the channel is private'),
  }).describe('Create a new Slack channel'),
};

// ============================================================================
// DISCORD SCHEMAS
// ============================================================================

export const discordSchemas = {
  send_message: z.object({
    action: z.literal('send_message'),
    channelId: z.string().min(1).describe('Discord channel ID or name'),
    message: z.string().min(1).describe('Message content to send'),
  }).describe('Send a message to a Discord channel'),

  list_channels: z.object({
    action: z.literal('list_channels'),
  }).describe('List all Discord channels'),

  list_users: z.object({
    action: z.literal('list_users'),
  }).describe('List all Discord users'),

  create_channel: z.object({
    action: z.literal('create_channel'),
    name: z.string().min(1).describe('Channel name'),
    type: z.number().optional().describe('Channel type (0 = text, 2 = voice)'),
  }).describe('Create a new Discord channel'),

  ban_user: z.object({
    action: z.literal('ban_user'),
    userId: z.string().min(1).describe('User ID to ban'),
    reason: z.string().optional().describe('Reason for the ban'),
    deleteMessageDays: z.number().optional().describe('Days of messages to delete'),
  }).describe('Ban a user from the server'),

  kick_user: z.object({
    action: z.literal('kick_user'),
    userId: z.string().min(1).describe('User ID to kick'),
    reason: z.string().optional().describe('Reason for the kick'),
  }).describe('Kick a user from the server'),
};

// ============================================================================
// JIRA SCHEMAS
// ============================================================================

export const jiraSchemas = {
  create_issue: z.object({
    action: z.literal('create_issue'),
    projectKey: z.string().min(1).describe('Jira project key (e.g., "PROJ")'),
    title: z.string().min(1).describe('Issue title/summary'),
    description: z.string().optional().describe('Issue description'),
    issueType: z.string().optional().describe('Issue type (e.g., "Bug", "Task")'),
  }).describe('Create a new Jira issue'),

  list_issues: z.object({
    action: z.literal('list_issues'),
    projectKey: z.string().min(1).describe('Jira project key'),
    status: z.string().optional().describe('Filter by status'),
  }).describe('List issues in a project'),

  get_issue: z.object({
    action: z.literal('get_issue'),
    issueKey: z.string().min(1).describe('Issue key (e.g., "PROJ-123")'),
  }).describe('Get details of a specific issue'),

  update_issue: z.object({
    action: z.literal('update_issue'),
    issueKey: z.string().min(1).describe('Issue key'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    status: z.string().optional().describe('New status'),
  }).describe('Update an existing issue'),

  add_comment: z.object({
    action: z.literal('add_comment'),
    issueKey: z.string().min(1).describe('Issue key'),
    comment: z.string().min(1).describe('Comment text'),
  }).describe('Add a comment to an issue'),

  list_projects: z.object({
    action: z.literal('list_projects'),
  }).describe('List all Jira projects'),
};

// ============================================================================
// LINEAR SCHEMAS
// ============================================================================

export const linearSchemas = {
  create_issue: z.object({
    action: z.literal('create_issue'),
    teamId: z.string().min(1).describe('Linear team ID'),
    title: z.string().min(1).describe('Issue title'),
    description: z.string().optional().describe('Issue description'),
    projectId: z.string().optional().describe('Project ID'),
  }).describe('Create a new Linear issue'),

  list_issues: z.object({
    action: z.literal('list_issues'),
    teamId: z.string().min(1).describe('Linear team ID'),
  }).describe('List issues in a team'),

  get_issue: z.object({
    action: z.literal('get_issue'),
    issueId: z.string().min(1).describe('Issue ID'),
  }).describe('Get details of a specific issue'),

  update_issue: z.object({
    action: z.literal('update_issue'),
    issueId: z.string().min(1).describe('Issue ID'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
  }).describe('Update an existing issue'),

  list_teams: z.object({
    action: z.literal('list_teams'),
  }).describe('List all Linear teams'),

  list_projects: z.object({
    action: z.literal('list_projects'),
    teamId: z.string().optional().describe('Filter by team ID'),
  }).describe('List all Linear projects'),
};

// ============================================================================
// GITHUB SCHEMAS
// ============================================================================

export const githubSchemas = {
  list_repos: z.object({
    action: z.literal('list_repos'),
  }).describe('List all repositories'),

  create_issue: z.object({
    action: z.literal('create_issue'),
    owner: z.string().min(1).describe('Repository owner'),
    repo: z.string().min(1).describe('Repository name'),
    title: z.string().min(1).describe('Issue title'),
    body: z.string().optional().describe('Issue body'),
  }).describe('Create a new GitHub issue'),

  list_issues: z.object({
    action: z.literal('list_issues'),
    owner: z.string().min(1).describe('Repository owner'),
    repo: z.string().min(1).describe('Repository name'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('Issue state filter'),
  }).describe('List issues in a repository'),

  create_pr: z.object({
    action: z.literal('create_pr'),
    owner: z.string().min(1).describe('Repository owner'),
    repo: z.string().min(1).describe('Repository name'),
    title: z.string().min(1).describe('Pull request title'),
    body: z.string().optional().describe('Pull request description'),
    head: z.string().min(1).describe('Source branch'),
    base: z.string().min(1).describe('Target branch'),
    draft: z.boolean().optional().describe('Create as draft PR'),
  }).describe('Create a new pull request'),

  list_prs: z.object({
    action: z.literal('list_prs'),
    owner: z.string().min(1).describe('Repository owner'),
    repo: z.string().min(1).describe('Repository name'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('PR state filter'),
  }).describe('List pull requests'),

  list_branches: z.object({
    action: z.literal('list_branches'),
    owner: z.string().min(1).describe('Repository owner'),
    repo: z.string().min(1).describe('Repository name'),
  }).describe('List branches in a repository'),

  create_branch: z.object({
    action: z.literal('create_branch'),
    owner: z.string().min(1).describe('Repository owner'),
    repo: z.string().min(1).describe('Repository name'),
    branchName: z.string().min(1).describe('New branch name'),
    fromBranch: z.string().optional().describe('Source branch (defaults to main)'),
  }).describe('Create a new branch'),
};

// ============================================================================
// GOOGLE DRIVE SCHEMAS
// ============================================================================

export const driveSchemas = {
  list: z.object({
    action: z.literal('list'),
    folderId: z.string().optional().describe('Folder ID to list'),
    mimeType: z.string().optional().describe('Filter by MIME type'),
  }).describe('List files in Google Drive'),

  search: z.object({
    action: z.literal('search'),
    query: z.string().min(1).describe('Search query'),
  }).describe('Search files in Google Drive'),

  upload: z.object({
    action: z.literal('upload'),
    fileName: z.string().min(1).describe('File name'),
    content: z.string().min(1).describe('File content'),
    mimeType: z.string().optional().describe('MIME type'),
    folderId: z.string().optional().describe('Destination folder ID'),
  }).describe('Upload a file to Google Drive'),

  create_folder: z.object({
    action: z.literal('create_folder'),
    folderName: z.string().min(1).describe('Folder name'),
    parentFolderId: z.string().optional().describe('Parent folder ID'),
  }).describe('Create a folder in Google Drive'),

  share: z.object({
    action: z.literal('share'),
    fileId: z.string().min(1).describe('File ID to share'),
    email: z.string().email().describe('Email to share with'),
    role: z.enum(['reader', 'writer', 'commenter']).optional().describe('Permission role'),
  }).describe('Share a file'),
};

// ============================================================================
// GOOGLE SHEETS SCHEMAS
// ============================================================================

export const sheetsSchemas = {
  list: z.object({
    action: z.literal('list'),
  }).describe('List Google Sheets'),

  export: z.object({
    action: z.literal('export'),
    startDate: z.string().optional().describe('Start date for data export'),
    endDate: z.string().optional().describe('End date for data export'),
    projectId: z.string().optional().describe('Filter by project'),
  }).describe('Export data to Google Sheets'),
};

// ============================================================================
// GOOGLE DOCS SCHEMAS
// ============================================================================

export const gdocsSchemas = {
  list: z.object({
    action: z.literal('list'),
  }).describe('List Google Docs'),

  read: z.object({
    action: z.literal('read'),
    documentId: z.string().min(1).describe('Document ID to read'),
  }).describe('Read a Google Doc'),

  create: z.object({
    action: z.literal('create'),
    title: z.string().min(1).describe('Document title'),
    content: z.string().optional().describe('Initial content'),
  }).describe('Create a new Google Doc'),
};

// ============================================================================
// GOOGLE CALENDAR SCHEMAS
// ============================================================================

export const calendarSchemas = {
  list: z.object({
    action: z.literal('list'),
    startDate: z.string().optional().describe('Start date for events'),
    endDate: z.string().optional().describe('End date for events'),
    maxResults: z.number().optional().describe('Maximum number of events'),
  }).describe('List calendar events'),

  create: z.object({
    action: z.literal('create'),
    summary: z.string().min(1).describe('Event title'),
    start: z.string().min(1).describe('Start date/time'),
    end: z.string().min(1).describe('End date/time'),
    description: z.string().optional().describe('Event description'),
    attendees: z.array(z.string().email()).optional().describe('Attendee emails'),
  }).describe('Create a calendar event'),

  update: z.object({
    action: z.literal('update'),
    eventId: z.string().min(1).describe('Event ID to update'),
    summary: z.string().optional().describe('New title'),
    start: z.string().optional().describe('New start date/time'),
    end: z.string().optional().describe('New end date/time'),
    description: z.string().optional().describe('New description'),
  }).describe('Update a calendar event'),

  delete: z.object({
    action: z.literal('delete'),
    eventId: z.string().min(1).describe('Event ID to delete'),
  }).describe('Delete a calendar event'),
};

// ============================================================================
// SCHEMA REGISTRY
// ============================================================================

/**
 * All integration schemas organized by integration type
 */
export const integrationSchemas = {
  vercel: vercelSchemas,
  gmail: gmailSchemas,
  slack: slackSchemas,
  discord: discordSchemas,
  jira: jiraSchemas,
  linear: linearSchemas,
  github: githubSchemas,
  drive: driveSchemas,
  sheets: sheetsSchemas,
  gdocs: gdocsSchemas,
  calendar: calendarSchemas,
  // Aliases
  google: gmailSchemas, // Default to gmail for @google
} as const;

/**
 * Get schema for a specific integration and action
 */
export function getSchema(integration: string, action: string): z.ZodObject<any> | null {
  const integrationSchemaSet = integrationSchemas[integration as keyof typeof integrationSchemas];
  if (!integrationSchemaSet) {
    return null;
  }
  
  const schema = integrationSchemaSet[action as keyof typeof integrationSchemaSet];
  return schema || null;
}

/**
 * Get all action names for an integration
 */
export function getActionsForIntegration(integration: string): string[] {
  const integrationSchemaSet = integrationSchemas[integration as keyof typeof integrationSchemas];
  if (!integrationSchemaSet) {
    return [];
  }
  return Object.keys(integrationSchemaSet);
}

/**
 * Parameter metadata for generating questions
 */
export const parameterQuestions: Record<string, { question: string; placeholder: string }> = {
  // Vercel
  projectName: {
    question: 'Which project would you like to use?',
    placeholder: 'Enter project name...',
  },
  deploymentId: {
    question: 'Which deployment would you like to use?',
    placeholder: 'Enter deployment ID...',
  },
  key: {
    question: 'What is the environment variable name?',
    placeholder: 'Enter variable name (e.g., API_KEY)...',
  },
  value: {
    question: 'What value should this environment variable have?',
    placeholder: 'Enter variable value...',
  },
  
  // Email
  to: {
    question: 'Who would you like to send this email to?',
    placeholder: 'Enter email address...',
  },
  subject: {
    question: 'What should the email subject be?',
    placeholder: 'Enter subject line...',
  },
  body: {
    question: 'What should the email say?',
    placeholder: 'Enter email content...',
  },
  
  // Slack/Discord
  channelId: {
    question: 'Which channel would you like to use?',
    placeholder: 'Enter channel name...',
  },
  message: {
    question: 'What message would you like to send?',
    placeholder: 'Enter your message...',
  },
  
  // Jira/Linear
  projectKey: {
    question: 'Which project should this be in?',
    placeholder: 'Enter project key (e.g., PROJ)...',
  },
  teamId: {
    question: 'Which team should this be assigned to?',
    placeholder: 'Select a team...',
  },
  issueKey: {
    question: 'Which issue are you referring to?',
    placeholder: 'Enter issue key (e.g., PROJ-123)...',
  },
  title: {
    question: 'What should the title be?',
    placeholder: 'Enter title...',
  },
  description: {
    question: 'Would you like to add a description?',
    placeholder: 'Enter description (optional)...',
  },
  
  // GitHub
  owner: {
    question: 'Which repository owner?',
    placeholder: 'Enter owner/organization name...',
  },
  repo: {
    question: 'Which repository?',
    placeholder: 'Enter repository name...',
  },
  head: {
    question: 'Which branch are you merging from?',
    placeholder: 'Enter source branch...',
  },
  base: {
    question: 'Which branch are you merging into?',
    placeholder: 'Enter target branch (e.g., main)...',
  },
  
  // Calendar
  summary: {
    question: 'What is the event title?',
    placeholder: 'Enter event title...',
  },
  start: {
    question: 'When does the event start?',
    placeholder: 'Enter start time (e.g., 2024-01-15 10:00)...',
  },
  end: {
    question: 'When does the event end?',
    placeholder: 'Enter end time...',
  },
  
  // Generic
  query: {
    question: 'What would you like to search for?',
    placeholder: 'Enter search query...',
  },
  name: {
    question: 'What name would you like to use?',
    placeholder: 'Enter name...',
  },
};

/**
 * Get question text for a parameter
 */
export function getQuestionForParameter(paramName: string): { question: string; placeholder: string } {
  const paramInfo = parameterQuestions[paramName];
  if (paramInfo && typeof paramInfo === 'object' && 'question' in paramInfo) {
    return paramInfo as { question: string; placeholder: string };
  }
  return {
    question: `What value should "${paramName}" have?`,
    placeholder: `Enter ${paramName}...`,
  };
}

export type VercelAction = keyof typeof vercelSchemas;
export type GmailAction = keyof typeof gmailSchemas;
export type SlackAction = keyof typeof slackSchemas;
export type DiscordAction = keyof typeof discordSchemas;
export type JiraAction = keyof typeof jiraSchemas;
export type LinearAction = keyof typeof linearSchemas;
export type GithubAction = keyof typeof githubSchemas;
export type DriveAction = keyof typeof driveSchemas;
export type SheetsAction = keyof typeof sheetsSchemas;
export type GdocsAction = keyof typeof gdocsSchemas;
export type CalendarAction = keyof typeof calendarSchemas;
