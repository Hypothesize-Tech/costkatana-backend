# AI Cost Tracker - Integration Guide

## Overview

This guide explains how API keys and project IDs work in the AI Cost Tracker system, and how to integrate them into your applications for comprehensive usage tracking and cost management.

## API Key Management

### Backend Implementation

**Storage & Security:**
- API keys are stored in the User model (`ai-cost-optimizer-backend/src/models/User.ts`)
- Keys are encrypted using AES-256-GCM encryption before storage
- Only masked versions are returned to the frontend
- Encryption/decryption handled in `ai-cost-optimizer-backend/src/utils/helpers.ts`

**Available Services:**
- OpenAI
- Anthropic
- Google AI
- AWS Bedrock

**Backend Endpoints:**
```
GET    /api/user/api-keys           - Get user's API keys (masked)
POST   /api/user/api-keys           - Add new API key
DELETE /api/user/api-keys/:service  - Remove API key
```

### Frontend Implementation

**Components:**
- `ApiKeySettings` - Manage API keys in settings
- `ApiKeyIntegration` - Integration guide modal
- `IntegrationDashboard` - Overview of integration status

**Usage:**
```typescript
import { userService } from '../services/user.service';

// Get API keys
const apiKeys = await userService.getApiKeys();

// Add new API key
await userService.addApiKey('openai', 'sk-...');

// Remove API key
await userService.removeApiKey('openai');
```

## Project ID System

### Backend Implementation

**Project Model:**
- Projects are stored in `ai-cost-optimizer-backend/src/models/Project.ts`
- Each project has a unique ObjectId used as project ID
- Projects include budget tracking, member management, and settings

**Usage Tracking:**
- Usage records in `Usage` model include optional `projectId` field
- Project analytics available via `AnalyticsService.getProjectAnalytics()`
- Budget monitoring and alerts per project

**Key Backend Services:**
```typescript
// Track usage with project ID
await AICostTrackerService.trackRequest(request, response, userId, {
    projectId: 'project-id',
    service: 'openai',
    tags: ['tag1', 'tag2'],
    costAllocation: {
        department: 'engineering',
        team: 'ai-team'
    }
});

// Get project analytics
const analytics = await AnalyticsService.getProjectAnalytics(projectId, filters);
```

### Frontend Implementation

**Components:**
- `ProjectCard` - Display project info with usage stats
- `ViewProjectModal` - Detailed project view with analytics
- `ProjectIdGuide` - Integration guide for project IDs

**Usage:**
```typescript
import { ProjectService } from '../services/project.service';

// Get projects
const projects = await ProjectService.getProjects();

// Get project analytics
const analytics = await ProjectService.getProjectUsage(
    projectId,
    startDate,
    endDate
);
```

## Integration Examples

### 1. Basic Usage Tracking

```typescript
import { AICostOptimizer } from 'ai-cost-optimizer';

const optimizer = new AICostOptimizer({
    apiKey: 'your-openai-api-key',
    provider: 'openai',
    trackUsage: true,
    defaultProjectId: 'your-project-id',
    dashboardConfig: {
        baseUrl: 'http://localhost:8000/api',
        apiKey: 'your-dashboard-api-key'
    }
});

// Track API usage
const response = await optimizer.optimize({
    prompt: 'Generate a product description',
    model: 'gpt-4',
    projectId: 'your-project-id',
    costAllocation: {
        department: 'marketing',
        team: 'content',
        purpose: 'product-descriptions'
    },
    tags: ['product', 'marketing']
});
```

### 2. Direct API Integration

```bash
# Track usage via REST API
curl -X POST "http://localhost:8000/api/usage/track" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "your-project-id",
    "service": "openai",
    "model": "gpt-4",
    "prompt": "Generate content...",
    "completion": "Generated content...",
    "promptTokens": 25,
    "completionTokens": 150,
    "totalTokens": 175,
    "cost": 0.0035,
    "responseTime": 1200,
    "costAllocation": {
        "department": "marketing",
        "team": "content"
    },
    "tags": ["product", "marketing"]
}'
```

### 3. Bulk Usage Import

```typescript
// Import historical usage data
const usageData = [
    {
        prompt: 'Email template generation',
        completion: 'Generated email...',
        model: 'gpt-3.5-turbo',
        cost: 0.002,
        tokens: 150,
        projectId: 'your-project-id',
        timestamp: '2024-01-15T10:30:00Z',
        costAllocation: {
            department: 'sales',
            team: 'outreach'
        }
    }
    // ... more records
];

await optimizer.bulkImport(usageData);
```

### 4. Project Analytics

```typescript
// Get project analytics
const analytics = await optimizer.getProjectAnalytics('your-project-id', {
    startDate: '2024-01-01',
    endDate: '2024-01-31',
    groupBy: 'day'
});

console.log('Total cost:', analytics.summary.totalCost);
console.log('Budget utilization:', analytics.summary.budgetUtilization);
console.log('Service breakdown:', analytics.breakdown.services);
```

## Environment Variables

Set these environment variables in your application:

```bash
# Backend Configuration
JWT_SECRET=your-jwt-secret
ENCRYPTION_KEY=your-encryption-key-32-chars
MONGODB_URI=mongodb://localhost:27017/ai-cost-tracker

# Frontend Configuration
VITE_API_URL=http://localhost:8000
VITE_DEFAULT_PROJECT_ID=your-default-project-id

# SDK Configuration
OPENAI_API_KEY=sk-your-openai-key
API_KEY=http://localhost:8000/api
PROJECT_ID=your-project-id
```

## Authentication

### JWT Tokens
- Use JWT tokens for API authentication
- Include in Authorization header: `Bearer YOUR_JWT_TOKEN`
- Tokens contain user ID and role information

### API Key Authentication
- API keys can also be used for authentication
- Stored encrypted in user profile
- Validated during authentication middleware

## Cost Allocation & Tagging

### Cost Allocation
```typescript
const costAllocation = {
    department: 'engineering',    // Department name
    team: 'ai-team',             // Team name
    purpose: 'feature-dev',      // Purpose/category
    client: 'acme-corp',         // Client name (for agencies)
    campaign: 'q1-2024'          // Campaign/project phase
};
```

### Tags
```typescript
const tags = [
    'product-description',       // Content type
    'automated',                 // Generation method
    'high-priority',            // Priority level
    'customer-facing'           // Audience
];
```

## Budget Management

### Project Budgets
- Set monthly/quarterly/yearly budgets per project
- Configure alert thresholds (50%, 75%, 90%)
- Track spending in real-time
- Get budget utilization percentages

### Budget Alerts
```typescript
const budgetConfig = {
    amount: 1000,               // Budget amount
    currency: 'USD',            // Currency
    period: 'monthly',          // Period
    alerts: [
        { threshold: 50, type: 'email' },
        { threshold: 80, type: 'both' },
        { threshold: 90, type: 'webhook' }
    ]
};
```

## Analytics & Reporting

### Available Metrics
- Total cost and token usage
- Cost per request/token
- Service and model breakdown
- Time-based trends
- Budget utilization
- Department/team allocation

### Export Formats
- JSON for programmatic access
- CSV for spreadsheet analysis
- Real-time webhooks for monitoring

## Frontend Integration

### Navigation
The Integration page is available at `/integration` and includes:
- API key status overview
- Project integration guide
- Code examples
- Environment variable setup

### Components Usage
```typescript
import { IntegrationDashboard } from '../components/integration';

// Display integration status
<IntegrationDashboard />

// Show API key integration modal
<ApiKeyIntegration isOpen={true} onClose={() => {}} />
```

## Security Best Practices

1. **API Key Storage**: Never store API keys in plain text
2. **Encryption**: Use AES-256-GCM for sensitive data
3. **Authentication**: Always validate JWT tokens
4. **Authorization**: Check project access permissions
5. **Rate Limiting**: Implement rate limiting for API endpoints
6. **Audit Logging**: Track all usage and changes

## Troubleshooting

### Common Issues

1. **API Key Not Working**
   - Verify key is correctly formatted
   - Check if key is properly encrypted/stored
   - Ensure service matches (openai, anthropic, etc.)

2. **Project ID Invalid**
   - Verify project exists and is active
   - Check user has access to project
   - Ensure project ID is valid MongoDB ObjectId

3. **Usage Not Tracking**
   - Verify authentication headers
   - Check project permissions
   - Validate request payload format

4. **Budget Alerts Not Working**
   - Check alert configuration
   - Verify webhook URLs are accessible
   - Ensure email settings are configured

### Debug Endpoints

```bash
# Check API key status
GET /api/user/api-keys

# Verify project access
GET /api/projects/:projectId

# Test usage tracking
POST /api/usage/track

# Get analytics
GET /api/analytics/projects/:projectId
```

## Support

For additional support:
- Check the API documentation at `/docs/api`
- Review example implementations in `/examples`
- Contact support for integration assistance 