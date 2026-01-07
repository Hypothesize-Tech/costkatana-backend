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
// AWS SCHEMAS
// ============================================================================

export const awsSchemas = {
  // Cost Explorer
  costs: z.object({
    action: z.literal('costs'),
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD, defaults to 30 days ago)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD, defaults to today)'),
    granularity: z.enum(['DAILY', 'MONTHLY', 'HOURLY']).optional().describe('Cost granularity'),
    groupBy: z.enum(['SERVICE', 'REGION', 'LINKED_ACCOUNT']).optional().describe('Group costs by dimension'),
  }).describe('Get AWS cost and usage data'),

  cost_breakdown: z.object({
    action: z.literal('cost_breakdown'),
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  }).describe('Get cost breakdown by AWS service'),

  cost_forecast: z.object({
    action: z.literal('cost_forecast'),
    days: z.number().optional().describe('Number of days to forecast (default: 30)'),
    granularity: z.enum(['DAILY', 'MONTHLY']).optional().describe('Forecast granularity'),
  }).describe('Get AWS cost forecast'),

  cost_anomalies: z.object({
    action: z.literal('cost_anomalies'),
    days: z.number().optional().describe('Number of days to check for anomalies (default: 30)'),
  }).describe('List cost anomalies'),

  // EC2
  list_ec2: z.object({
    action: z.literal('list_ec2'),
    region: z.string().optional().describe('AWS region (e.g., us-east-1)'),
    state: z.enum(['running', 'stopped', 'all']).optional().describe('Filter by instance state'),
  }).describe('List EC2 instances'),

  stop_ec2: z.object({
    action: z.literal('stop_ec2'),
    instanceIds: z.array(z.string().min(1)).min(1).describe('EC2 instance IDs to stop'),
    region: z.string().optional().describe('AWS region'),
  }).describe('Stop EC2 instances'),

  start_ec2: z.object({
    action: z.literal('start_ec2'),
    instanceIds: z.array(z.string().min(1)).min(1).describe('EC2 instance IDs to start'),
    region: z.string().optional().describe('AWS region'),
  }).describe('Start EC2 instances'),

  idle_instances: z.object({
    action: z.literal('idle_instances'),
    cpuThreshold: z.number().optional().describe('CPU utilization threshold % (default: 5)'),
    days: z.number().optional().describe('Number of days to analyze (default: 7)'),
    region: z.string().optional().describe('AWS region'),
  }).describe('Find idle/underutilized EC2 instances'),

  create_ec2: z.object({
    action: z.literal('create_ec2'),
    instanceName: z.string().min(1).describe('EC2 instance name'),
    instanceType: z.string().optional().describe('Instance type (e.g., t3.micro, t3.small)'),
    region: z.string().optional().describe('AWS region'),
    vpcId: z.string().optional().describe('VPC ID (optional, uses default if not provided)'),
    subnetId: z.string().optional().describe('Subnet ID (optional, uses default if not provided)'),
    securityGroupId: z.string().optional().describe('Security group ID (optional, creates default if not provided)'),
    keyPairName: z.string().optional().describe('Key pair name (optional, creates default if not provided)'),
    tags: z.record(z.string()).optional().describe('Additional tags for the instance'),
  }).describe('Create a new EC2 instance'),

  // S3
  list_s3: z.object({
    action: z.literal('list_s3'),
  }).describe('List S3 buckets'),

  create_s3: z.object({
    action: z.literal('create_s3'),
    bucketName: z.string().min(1).describe('S3 bucket name (must be globally unique)'),
    region: z.string().optional().describe('AWS region (defaults to us-east-1)'),
  }).describe('Create a new S3 bucket'),

  // RDS
  list_rds: z.object({
    action: z.literal('list_rds'),
    region: z.string().optional().describe('AWS region'),
  }).describe('List RDS database instances'),

  create_rds: z.object({
    action: z.literal('create_rds'),
    dbInstanceIdentifier: z.string().min(1).describe('Database instance identifier'),
    engine: z.enum(['mysql', 'postgres', 'mariadb', 'oracle', 'sqlserver']).describe('Database engine'),
    dbInstanceClass: z.string().optional().describe('Instance class (e.g., db.t3.micro)'),
    allocatedStorage: z.number().optional().describe('Allocated storage in GB (default: 20)'),
    region: z.string().optional().describe('AWS region'),
    masterUsername: z.string().optional().describe('Master username (default: admin)'),
    masterUserPassword: z.string().optional().describe('Master password (auto-generated if not provided)'),
    tags: z.record(z.string()).optional().describe('Additional tags for the database'),
  }).describe('Create a new RDS database instance'),

  // Lambda
  list_lambda: z.object({
    action: z.literal('list_lambda'),
    region: z.string().optional().describe('AWS region'),
  }).describe('List Lambda functions'),

  create_lambda: z.object({
    action: z.literal('create_lambda'),
    functionName: z.string().min(1).describe('Lambda function name'),
    runtime: z.enum(['nodejs18.x', 'nodejs20.x', 'python3.11', 'python3.12', 'java17', 'go1.x']).optional().describe('Runtime environment'),
    handler: z.string().optional().describe('Handler (e.g., index.handler)'),
    memorySize: z.number().optional().describe('Memory in MB (default: 128)'),
    timeout: z.number().optional().describe('Timeout in seconds (default: 3)'),
    region: z.string().optional().describe('AWS region'),
    tags: z.record(z.string()).optional().describe('Additional tags for the function'),
  }).describe('Create a new Lambda function'),

  // DynamoDB
  create_dynamodb: z.object({
    action: z.literal('create_dynamodb'),
    tableName: z.string().min(1).describe('DynamoDB table name'),
    partitionKeyName: z.string().min(1).describe('Partition key name'),
    partitionKeyType: z.enum(['S', 'N', 'B']).optional().describe('Partition key type (S=String, N=Number, B=Binary)'),
    sortKeyName: z.string().optional().describe('Sort key name (optional)'),
    sortKeyType: z.enum(['S', 'N', 'B']).optional().describe('Sort key type'),
    billingMode: z.enum(['PAY_PER_REQUEST', 'PROVISIONED']).optional().describe('Billing mode (default: PAY_PER_REQUEST)'),
    region: z.string().optional().describe('AWS region'),
    tags: z.record(z.string()).optional().describe('Additional tags for the table'),
  }).describe('Create a new DynamoDB table'),

  // ECS
  create_ecs: z.object({
    action: z.literal('create_ecs'),
    clusterName: z.string().min(1).describe('ECS cluster name'),
    region: z.string().optional().describe('AWS region'),
    enableContainerInsights: z.boolean().optional().describe('Enable Container Insights monitoring'),
    tags: z.record(z.string()).optional().describe('Additional tags for the cluster'),
  }).describe('Create a new ECS cluster'),

  // General
  optimize: z.object({
    action: z.literal('optimize'),
    service: z.enum(['ec2', 'rds', 'lambda', 's3', 'all']).optional().describe('Service to optimize'),
  }).describe('Get cost optimization recommendations'),

  status: z.object({
    action: z.literal('status'),
  }).describe('Get AWS connection status and overview'),
};

// ============================================================================
// MONGODB SCHEMAS
// ============================================================================

export const mongodbSchemas = {
  list_collections: z.object({
    action: z.literal('list_collections'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
  }).describe('List all collections in the database'),

  list_databases: z.object({
    action: z.literal('list_databases'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
  }).describe('List all databases'),

  database_stats: z.object({
    action: z.literal('database_stats'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
  }).describe('Get database statistics and size information'),

  collection_stats: z.object({
    action: z.literal('collection_stats'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
    collectionName: z.string().min(1).describe('Collection name'),
  }).describe('Get statistics for a specific collection'),

  find: z.object({
    action: z.literal('find'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
    collectionName: z.string().min(1).describe('Collection name'),
    query: z.string().optional().describe('MongoDB query filter (JSON format)'),
    limit: z.number().optional().describe('Maximum number of documents to return'),
    skip: z.number().optional().describe('Number of documents to skip'),
  }).describe('Query documents from a collection'),

  insert: z.object({
    action: z.literal('insert'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
    collectionName: z.string().min(1).describe('Collection name'),
    documents: z.string().min(1).describe('Documents to insert (JSON format)'),
  }).describe('Insert documents into a collection'),

  update: z.object({
    action: z.literal('update'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
    collectionName: z.string().min(1).describe('Collection name'),
    query: z.string().min(1).describe('Query filter (JSON format)'),
    update: z.string().min(1).describe('Update operations (JSON format)'),
  }).describe('Update documents in a collection'),

  delete: z.object({
    action: z.literal('delete'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
    collectionName: z.string().min(1).describe('Collection name'),
    query: z.string().min(1).describe('Query filter (JSON format)'),
  }).describe('Delete documents from a collection'),

  create_collection: z.object({
    action: z.literal('create_collection'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
    collectionName: z.string().min(1).describe('Collection name'),
    schema: z.string().optional().describe('JSON schema for validation'),
  }).describe('Create a new collection'),

  drop_collection: z.object({
    action: z.literal('drop_collection'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
    collectionName: z.string().min(1).describe('Collection name'),
  }).describe('Drop a collection'),

  create_index: z.object({
    action: z.literal('create_index'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
    collectionName: z.string().min(1).describe('Collection name'),
    indexName: z.string().min(1).describe('Index name'),
    fields: z.string().min(1).describe('Fields to index (JSON format)'),
  }).describe('Create an index on a collection'),

  aggregate: z.object({
    action: z.literal('aggregate'),
    connectionId: z.string().optional().describe('MongoDB connection ID'),
    collectionName: z.string().min(1).describe('Collection name'),
    pipeline: z.string().min(1).describe('Aggregation pipeline (JSON format)'),
  }).describe('Run aggregation pipeline on a collection'),

  help: z.object({
    action: z.literal('help'),
  }).describe('Get help with MongoDB commands'),
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
  aws: awsSchemas,
  mongodb: mongodbSchemas,
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
  
  // AWS
  instanceIds: {
    question: 'Which EC2 instance(s) would you like to use?',
    placeholder: 'Enter instance ID (e.g., i-1234567890abcdef0)...',
  },
  region: {
    question: 'Which AWS region?',
    placeholder: 'Enter region (e.g., us-east-1)...',
  },
  startDate: {
    question: 'What start date would you like?',
    placeholder: 'Enter start date (YYYY-MM-DD)...',
  },
  endDate: {
    question: 'What end date would you like?',
    placeholder: 'Enter end date (YYYY-MM-DD)...',
  },
  granularity: {
    question: 'What granularity would you like?',
    placeholder: 'Select granularity (DAILY, MONTHLY, HOURLY)...',
  },
  service: {
    question: 'Which AWS service would you like to optimize?',
    placeholder: 'Select service (ec2, rds, lambda, s3, all)...',
  },
  cpuThreshold: {
    question: 'What CPU threshold should be considered idle?',
    placeholder: 'Enter CPU % threshold (default: 5)...',
  },
  
  // MongoDB
  connectionId: {
    question: 'Which MongoDB connection would you like to use?',
    placeholder: 'Select a connection...',
  },
  collectionName: {
    question: 'Which collection would you like to query?',
    placeholder: 'Enter collection name...',
  },
  query: {
    question: 'What query would you like to run?',
    placeholder: 'Enter MongoDB query (JSON format)...',
  },
  documents: {
    question: 'What documents would you like to insert?',
    placeholder: 'Enter documents (JSON format)...',
  },
  update: {
    question: 'What updates would you like to apply?',
    placeholder: 'Enter update operations (JSON format)...',
  },
  indexName: {
    question: 'What should the index be named?',
    placeholder: 'Enter index name...',
  },
  fields: {
    question: 'Which fields should be indexed?',
    placeholder: 'Enter fields (JSON format)...',
  },
  pipeline: {
    question: 'What aggregation pipeline would you like to run?',
    placeholder: 'Enter pipeline (JSON format)...',
  },
  limit: {
    question: 'How many documents would you like to retrieve?',
    placeholder: 'Enter limit (default: 10)...',
  },
  skip: {
    question: 'How many documents should be skipped?',
    placeholder: 'Enter skip count (default: 0)...',
  },
  
  // Generic
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
export type AWSAction = keyof typeof awsSchemas;