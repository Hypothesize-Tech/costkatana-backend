# MongoDB MCP Integration Guide

## Overview

CostKatana's MongoDB MCP (Model Context Protocol) integration provides AI agents (Claude, Cursor, Windsurf, etc.) with secure, read-only access to your MongoDB databases for cost optimization analysis and insights.

## Features

- **15 Read-Only Tools**: Query, analyze, and optimize MongoDB operations
- **Multi-Tenant BYOC**: Bring Your Own Connection - use your own MongoDB instances
- **Comprehensive Security**: Query validation, field redaction, rate limiting, circuit breakers
- **Dual Transport**: Local (stdio) for development, Remote (HTTP/SSE) for production
- **Cost Optimization**: AI-powered index suggestions and query analysis

## Architecture

```
┌─────────────────┐
│  AI Client      │
│ (Cursor/Claude) │
└────────┬────────┘
         │
    ┌────▼─────┐
    │  MCP     │
    │  Gateway │
    └────┬─────┘
         │
    ┌────▼──────────┐
    │  Policy       │
    │  Engine       │
    └────┬──────────┘
         │
    ┌────▼──────────┐
    │  MongoDB MCP  │
    │  Service      │
    └────┬──────────┘
         │
    ┌────▼──────────┐
    │  Your MongoDB │
    │  (BYOC)       │
    └───────────────┘
```

## Quick Start

### 1. Create MongoDB Connection

```bash
POST /api/mcp/mongodb/connections
Authorization: Bearer <your-jwt-token>

{
  "alias": "Production Database",
  "connectionString": "mongodb+srv://user:pass@cluster.mongodb.net/mydb",
  "database": "mydb",
  "metadata": {
    "description": "Production MongoDB Atlas",
    "environment": "production",
    "provider": "atlas",
    "maxDocsPerQuery": 500,
    "maxQueryTimeMs": 8000
  }
}
```

### 2. Configure Local Client (Cursor/Claude)

Create or update `~/.config/cursor/mcp-config.json` or `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mongodb-costkatana": {
      "command": "node",
      "args": [
        "/path/to/costkatana-backend/dist/services/mongodbMcpStdio.service.js"
      ],
      "env": {
        "MONGODB_USER_ID": "<your-user-id>",
        "MONGODB_CONNECTION_ID": "<connection-id-from-step-1>",
        "MONGODB_URI": "mongodb://localhost:27017/costkatana",
        "NODE_ENV": "development"
      }
    }
  }
}
```

### 3. Start Using Tools

In Cursor or Claude:

```
"List all collections in my database"
"Show me the schema for the users collection"
"Find slow queries on the orders collection"
"Suggest indexes for this query: { status: 'active', createdAt: { $gte: ... } }"
```

## Available Tools

### Query Tools

1. **find**: Query documents with filters
   ```json
   {
     "collection": "users",
     "query": { "status": "active" },
     "limit": 10,
     "sort": { "createdAt": -1 }
   }
   ```

2. **aggregate**: Run aggregation pipelines
   ```json
   {
     "collection": "orders",
     "pipeline": [
       { "$match": { "status": "completed" } },
       { "$group": { "_id": "$userId", "total": { "$sum": "$amount" } } }
     ]
   }
   ```

3. **count**: Count documents
   ```json
   {
     "collection": "products",
     "query": { "inStock": true }
   }
   ```

4. **distinct**: Get unique values
   ```json
   {
     "collection": "orders",
     "field": "status"
   }
   ```

### Schema & Metadata Tools

5. **listCollections**: List all collections
6. **listIndexes**: Show indexes for a collection
7. **collectionStats**: Get storage statistics
8. **analyzeSchema**: Infer schema from samples

### Performance Tools

9. **explainQuery**: Get execution plan
   ```json
   {
     "collection": "users",
     "query": { "email": "user@example.com" },
     "verbosity": "executionStats"
   }
   ```

10. **suggestIndexes**: AI-powered index recommendations
11. **analyzeSlowQueries**: Find optimization opportunities
12. **estimateQueryCost**: Estimate query performance impact

### Utility Tools

13. **validateQuery**: Dry-run query validation
14. **sampleDocuments**: Get random samples
15. **getDatabaseStats**: Database-level statistics

## Security & Guardrails

### Connection Security

- **Encrypted Storage**: Connection strings encrypted with AES-256-GCM
- **Short-Lived Credentials**: Optional 1-hour TTL for credentials
- **Tenant Isolation**: Zero connection pooling across tenants
- **Automatic Cleanup**: Idle connections closed after 10 minutes

### Query Safety

- **Blocked Operators**: `$where`, `$function`, `$eval`, `$expr`, etc.
- **Hard Limits**: 500 docs/query, 8s timeout, 16MB response
- **Field Redaction**: Automatic removal of sensitive fields (passwords, tokens, keys)
- **Collection Control**: Optional allowlist/blocklist per connection

### Rate Limiting & Circuit Breaker

- **Rate Limit**: 100 requests/minute per tenant
- **Circuit Breaker**: Opens after 5 failures, 1-minute timeout, 5-minute reset
- **Audit Logging**: All operations logged with query hash, duration, results

## Advanced Configuration

### Connection Metadata

```json
{
  "metadata": {
    "allowedCollections": ["users", "orders", "products"],
    "blockedCollections": ["admin", "system"],
    "blockedFields": {
      "users": ["passwordHash", "ssn"],
      "orders": ["creditCardNumber"]
    },
    "maxDocsPerQuery": 100,
    "maxQueryTimeMs": 5000,
    "credentialExpiry": "2024-12-31T23:59:59Z"
  }
}
```

### Environment Variables

```bash
# Query Limits
MCP_MONGODB_MAX_DOCS=500
MCP_MONGODB_TIMEOUT_MS=8000
MCP_MONGODB_MAX_RESPONSE_MB=16

# Connection Settings
MCP_MONGODB_IDLE_TIMEOUT_MS=600000
MCP_MONGODB_POOL_CLEANUP_MS=300000
MCP_MONGODB_CREDENTIAL_TTL_MS=3600000

# Security
MONGODB_CONNECTION_ENCRYPTION_KEY=your-secret-key

# Rate Limiting
MCP_MONGODB_RATE_LIMIT=100
MCP_MONGODB_RATE_WINDOW_MS=60000

# Circuit Breaker
MCP_MONGODB_CB_THRESHOLD=5
MCP_MONGODB_CB_TIMEOUT_MS=60000
MCP_MONGODB_CB_RESET_MS=300000

# Logging
MCP_MONGODB_LOG_QUERIES=true
MCP_MONGODB_LOG_RESULTS=false
```

## API Endpoints

### Connection Management

- `GET /api/mcp/mongodb/connections` - List connections
- `POST /api/mcp/mongodb/connections` - Create connection
- `PUT /api/mcp/mongodb/connections/:id` - Update connection
- `DELETE /api/mcp/mongodb/connections/:id` - Delete connection
- `POST /api/mcp/mongodb/connections/:id/validate` - Validate connection

### MCP Protocol

- `POST /api/mcp/mongodb` - Execute tool (JSON-RPC 2.0)
- `GET /api/mcp/mongodb/tools` - List available tools

## Production Deployment

### Docker Compose

```yaml
services:
  costkatana-backend:
    image: costkatana/backend:latest
    environment:
      - MONGODB_URI=mongodb://mongo:27017/costkatana
      - MONGODB_CONNECTION_ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - MCP_MONGODB_MAX_DOCS=500
      - MCP_MONGODB_TIMEOUT_MS=8000
    ports:
      - "3000:3000"
```

### Kubernetes

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mongodb-mcp-secrets
type: Opaque
stringData:
  MONGODB_CONNECTION_ENCRYPTION_KEY: "your-secret-key"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: costkatana-backend
spec:
  template:
    spec:
      containers:
      - name: backend
        image: costkatana/backend:latest
        env:
        - name: MONGODB_CONNECTION_ENCRYPTION_KEY
          valueFrom:
            secretKeyRef:
              name: mongodb-mcp-secrets
              key: MONGODB_CONNECTION_ENCRYPTION_KEY
```

## Troubleshooting

### Connection Validation Fails

```bash
# Test connection manually
POST /api/mcp/mongodb/connections/:id/validate

# Check logs
grep "MongoDB connection validation" logs/server.log

# Common issues:
# - Network: Firewall blocking MongoDB port
# - Auth: Invalid credentials
# - Encryption: Wrong encryption key (can't decrypt)
```

### Circuit Breaker Opens

```bash
# Check circuit breaker status
grep "circuit breaker" logs/server.log

# Reset by waiting 5 minutes or restarting service
# Fix underlying MongoDB issues first
```

### Query Rejected by Policy

```bash
# Validate query first
POST /api/mcp/mongodb
{
  "method": "tools/call",
  "params": {
    "name": "validateQuery",
    "arguments": {
      "collection": "users",
      "query": { "email": "test@example.com" }
    }
  }
}

# Check for:
# - Blocked operators ($where, $function)
# - Collection not in allowlist
# - Collection in blocklist
```

## Best Practices

1. **Start Read-Only**: Only expose read-only access initially
2. **Use Allowlists**: Define allowed collections explicitly
3. **Set Limits**: Configure appropriate maxDocsPerQuery and maxQueryTimeMs
4. **Monitor Usage**: Track query patterns and costs
5. **Rotate Credentials**: Use short-lived credentials (1-hour TTL)
6. **Test Validation**: Always validate connections after creation
7. **Review Audit Logs**: Regularly review query patterns

## Cost Optimization Examples

### Find Missing Indexes

```
"Explain this query and suggest indexes:
collection: orders
query: { status: 'pending', createdAt: { $gte: ISODate('2024-01-01') } }"
```

### Analyze Collection Performance

```
"Show me stats for the users collection and identify optimization opportunities"
```

### Estimate Query Cost

```
"Estimate the cost of running this aggregation:
collection: analytics
pipeline: [
  { $match: { timestamp: { $gte: ... } } },
  { $group: { _id: '$userId', count: { $sum: 1 } } }
]"
```

## Support

- **Documentation**: https://docs.costkatana.com/mcp/mongodb
- **Issues**: https://github.com/cost-katana/costkatana-backend/issues
- **Email**: support@costkatana.com

## License

MIT License - see LICENSE file for details
