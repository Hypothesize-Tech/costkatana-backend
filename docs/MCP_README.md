# Cost Katana MCP Server

## Overview

The Cost Katana MCP Server provides a standardized interface for AI agents to interact with 8 integrations (Vercel, GitHub, Google Workspace, Slack, Discord, Jira, Linear, MongoDB) through the Model Context Protocol (MCP).

## Features

- **8 Integration Servers**: Full CRUD operations for all major services
- **Granular Permissions**: 4-level permission system (user, integration, tool, resource)
- **OAuth Scope Mapping**: Automatic mapping of OAuth scopes to tool permissions
- **Dangerous Operation Protection**: User confirmation required for DELETE operations
- **Rate Limiting**: Prevents abuse with per-integration rate limits
- **Audit Logging**: Complete audit trail of all operations
- **Dual Transports**: stdio (CLI) and SSE (web) support
- **Generic HTTP Tool**: Flexible HTTP client with security controls

## Architecture

```
┌─────────────────────────────────────────┐
│     External MCP Clients                │
│   (Claude Desktop, Cursor, Manus AI)    │
└────────────────┬────────────────────────┘
                 │
                 │ MCP Protocol
                 │
┌────────────────▼────────────────────────┐
│     Universal MCP Server                │
│   ┌──────────────────────────────────┐  │
│   │     Tool Registry                │  │
│   │  ┌───────────┐  ┌──────────────┐│  │
│   │  │ Vercel    │  │  GitHub      ││  │
│   │  └───────────┘  └──────────────┘│  │
│   │  ┌───────────┐  ┌──────────────┐│  │
│   │  │ Google    │  │  Slack       ││  │
│   │  └───────────┘  └──────────────┘│  │
│   │  ┌───────────┐  ┌──────────────┐│  │
│   │  │ Discord   │  │  Jira        ││  │
│   │  └───────────┘  └──────────────┘│  │
│   │  ┌───────────┐  ┌──────────────┐│  │
│   │  │ Linear    │  │  MongoDB     ││  │
│   │  └───────────┘  └──────────────┘│  │
│   └──────────────────────────────────┘  │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│   Existing Cost Katana Services         │
│   (Vercel, GitHub, Google, etc.)        │
└─────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Node.js 18+
- Cost Katana account with API key
- Active integrations (Vercel, GitHub, Google, etc.)

### For Claude Desktop (stdio)

1. Install Cost Katana MCP CLI globally:

```bash
npm install -g @costkatana/mcp-server
```

2. Configure Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cost-katana": {
      "command": "cost-katana-mcp",
      "args": ["YOUR_API_KEY"],
      "env": {
        "COST_KATANA_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

3. Restart Claude Desktop

### For Web Applications (SSE)

1. Install in your project:

```bash
npm install @costkatana/mcp-server
```

2. Initialize MCP in your backend:

```typescript
import { initializeMCP } from '@costkatana/mcp-server';
import mcpRoutes from '@costkatana/mcp-server/routes';

// Initialize MCP tools
initializeMCP();

// Add routes
app.use('/api/mcp', mcpRoutes);
```

3. Connect from frontend:

```typescript
const eventSource = new EventSource('/api/mcp/sse', {
  headers: {
    'X-API-Key': 'YOUR_API_KEY'
  }
});

eventSource.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  // Handle MCP messages
});
```

## Usage

### Available Tools

The MCP server exposes 80+ tools across 8 integrations:

#### Vercel (13 tools)
- Projects: list, get, create, update, delete
- Deployments: list, get, create, rollback
- Domains: list, add, remove
- Environment Variables: list, set, delete

#### GitHub (12 tools)
- Repositories: list, create
- Issues: list, get, create, update, close
- Pull Requests: list, create, update, merge
- Branches: list, create, delete

#### Google Workspace (13 tools)
- Drive: list files, get file, upload, update, delete, create folder, share
- Sheets: list spreadsheets, get values, update values, append values
- Docs: list documents, get document, create document

#### Slack (7 tools)
- Channels: list, create, archive
- Messages: send, update, delete
- Users: list

#### Discord (9 tools)
- Channels: list, create, delete
- Messages: send, edit, delete
- Members: list, kick, ban

#### Jira (8 tools)
- Projects: list
- Issues: list, get, create, update, delete, add comment, transition

#### Linear (7 tools)
- Teams: list
- Projects: list
- Issues: list, get, create, update, delete

#### MongoDB (6 tools)
- find, aggregate, count
- insert, update, delete (with security controls)

#### Generic HTTP Tool (1 tool)
- http_request: Make authenticated HTTP requests to allowlisted domains

### Example: Using with Claude Desktop

Once configured, you can ask Claude to interact with your integrations:

```
You: "List my Vercel projects"
Claude: [Uses vercel_list_projects tool]

You: "Create a new GitHub issue in my repo"
Claude: [Uses github_create_issue tool]

You: "Show me the latest deployments for project X"
Claude: [Uses vercel_list_deployments tool]
```

### Example: Programmatic Access

```typescript
import { MCPServer, ToolRegistry } from '@costkatana/mcp-server';

// Get available tools
const tools = ToolRegistry.toMCPDefinitions();

// Execute a tool
const result = await ToolRegistry.executeTool(
  'vercel_list_projects',
  { limit: 10 },
  {
    userId: 'user-id',
    connectionId: 'connection-id',
    integration: 'vercel',
    permissions: [],
    scopes: [],
    isAdmin: false,
  }
);
```

## Permissions

### OAuth Scope Mapping

The system automatically maps OAuth scopes to tool permissions:

**GitHub Example:**
- `repo` scope → `github_list_repos`, `github_create_repo`, `github_list_branches`, `github_create_branch`
- `issues` scope → `github_list_issues`, `github_get_issue`, `github_create_issue`, `github_update_issue`
- `repo:delete` scope → `github_delete_branch`

**Google Example:**
- `drive.readonly` → `drive_list_files`, `drive_get_file`
- `drive.file` → `drive_upload_file`, `drive_update_file`, `drive_create_folder`
- `drive` → All Drive tools including `drive_delete_file`

### Dangerous Operations

DELETE operations and other dangerous actions require explicit user confirmation:

1. System detects dangerous operation (e.g., `vercel_delete_project`)
2. Confirmation request sent via SSE to frontend
3. User sees confirmation dialog with impact description
4. User confirms or denies within 2 minutes
5. Operation proceeds or is rejected
6. All confirmations are audit logged

### Resource-Level Restrictions

You can restrict access to specific resources:

```typescript
await PermissionManager.grantPermission(
  userId,
  'vercel',
  connectionId,
  ['projects:read', 'projects:delete'],
  {
    resourceRestrictions: {
      projectIds: ['proj_abc123', 'proj_def456'],
      ownOnly: true,
    },
  }
);
```

## Rate Limits

Default rate limits per user per integration:

- GET requests: 100/minute
- POST/PUT/PATCH: 50/minute
- DELETE: 10/hour
- Generic HTTP Tool: 50/hour

## Security

### Authentication
- All requests require valid Cost Katana API key
- API keys are validated against User database
- Inactive users are rejected

### Authorization
- 4-level permission system: user → integration → tool → resource
- OAuth scopes enforced per tool
- Resource-level access control
- Admin users can bypass confirmations (with enhanced audit log)

### Input Validation
- All tool inputs validated against JSON schemas
- MongoDB queries sanitized to prevent injection
- Dangerous operators (`$where`, `$function`) blocked
- System collections protected

### Network Security
- Generic HTTP tool restricted to allowlist
- Request/response logging
- Rate limiting per user
- 30-second timeout on HTTP requests

## API Reference

### REST Endpoints

#### Initialize MCP
```http
POST /api/mcp/initialize
Authorization: Bearer {API_KEY}
```

#### List Tools
```http
GET /api/mcp/tools
Authorization: Bearer {API_KEY}
```

Response:
```json
{
  "success": true,
  "tools": [
    {
      "name": "vercel_list_projects",
      "description": "List all Vercel projects",
      "inputSchema": {
        "type": "object",
        "properties": {
          "limit": { "type": "number" }
        }
      }
    }
  ],
  "count": 80
}
```

#### Get Permissions
```http
GET /api/mcp/permissions
Authorization: Bearer {API_KEY}
```

#### Submit Confirmation
```http
POST /api/mcp/confirmation
Content-Type: application/json

{
  "confirmationId": "confirm_123",
  "confirmed": true
}
```

### SSE Connection

```http
GET /api/mcp/sse
X-API-Key: {API_KEY}
```

Events:
- `connected`: Connection established
- `message`: MCP message
- `confirmation/request`: Dangerous operation confirmation needed
- `ping`: Keepalive

## Troubleshooting

### "Authentication failed"
- Verify API key is correct
- Check user account is active
- Ensure API key hasn't expired

### "No active {integration} connection"
- Connect integration in Cost Katana dashboard
- Verify OAuth connection is active
- Check if access token needs refresh

### "Permission denied"
- Check OAuth scopes granted during connection
- Verify tool is allowed by scopes
- Contact admin to grant additional permissions

### "Rate limit exceeded"
- Wait for rate limit window to reset
- Reduce request frequency
- Contact support for higher limits

## Development

### Running Tests

```bash
npm test
```

### Building

```bash
npm run build
```

### Local Development

```bash
# Start MCP server with stdio
npm run mcp-server YOUR_API_KEY

# Start backend with SSE
npm run dev
```

## Support

- Documentation: https://docs.costkatana.com/mcp
- GitHub: https://github.com/costkatana/mcp-server
- Email: support@costkatana.com

## License

MIT © Cost Katana
