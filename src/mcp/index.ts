/**
 * MCP Module Exports
 */

// Initialization
export { initializeMCP, isMCPInitialized, resetMCP } from './init';

// Server
export { MCPServer, MCPServerConfig } from './server';

// Types
export * from './types/mcp.types';
export * from './types/standard-response';
export * from './types/permission.types';
export * from './types/tool-schema';

// Transports
export { BaseTransport } from './transports/base.transport';
export { StdioTransport } from './transports/stdio.transport';
export { SSETransport } from './transports/sse.transport';

// Auth
export { MCPAuthService, MCPAuthContext } from './auth/mcp-auth';
export { TokenManager } from './auth/token-manager';

// Registry
export { ToolRegistry } from './registry/tool-registry';
export * from './registry/tool-metadata';

// Permissions
export { PermissionManager } from './permissions/permission-manager';
export { OAuthScopeMapper } from './permissions/oauth-scope-mapper';
export { ConfirmationService } from './permissions/confirmation-service';
export { PermissionValidator } from './permissions/permission-validator';

// Utils
export { AuditLogger } from './utils/audit-logger';
export { RateLimiter } from './utils/rate-limiter';
export * from './utils/error-mapper';

// Integrations (for direct use if needed)
export { VercelMCP } from './integrations/vercel.mcp';
export { GitHubMCP } from './integrations/github.mcp';
export { GoogleMCP } from './integrations/google.mcp';
export { SlackMCP } from './integrations/slack.mcp';
export { DiscordMCP } from './integrations/discord.mcp';
export { JiraMCP } from './integrations/jira.mcp';
export { LinearMCP } from './integrations/linear.mcp';
export { MongoDBMCP } from './integrations/mongodb.mcp';
export { GenericHTTPTool } from './tools/generic-http.tool';
