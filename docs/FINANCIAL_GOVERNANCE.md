# Financial Governance & Team Collaboration

## Overview

The Financial Governance & Team Collaboration feature transforms the AI Cost Optimizer from an individual usage tracker to an enterprise-ready platform for managing AI spending across teams and projects. This feature provides centralized control, budget management, approval workflows, and shared resources.

## Key Features

### 1. Project Management
- **Create Projects**: Organize AI usage by project with defined budgets
- **Team Collaboration**: Add team members with different roles (owner, admin, member, viewer)
- **Budget Controls**: Set monthly, quarterly, or yearly budgets with automatic alerts
- **Cost Allocation**: Tag and track costs by department, team, client, or custom categories

### 2. Budget Management
- **Real-time Tracking**: Monitor spending against budgets in real-time
- **Budget Alerts**: Automatic notifications at configurable thresholds (50%, 80%, 90%)
- **Burndown Charts**: Visual representation of budget consumption
- **Period-based Budgets**: Support for monthly, quarterly, yearly, or one-time budgets

### 3. Approval Workflows
- **Spending Limits**: Set approval thresholds for expensive operations
- **Request Management**: Review and approve/reject requests with comments
- **Requester History**: View historical data for informed decision-making
- **Automatic Expiration**: Requests expire after 24 hours if not addressed

### 4. Shared Prompt Library
- **Template Management**: Create, share, and version control effective prompts
- **Variable Support**: Dynamic templates with variables and default values
- **Usage Analytics**: Track template performance and savings
- **Visibility Controls**: Private, project-level, or public sharing

### 5. Cost Allocation & Reporting
- **Detailed Breakdown**: Analyze costs by service, model, user, or custom tags
- **Export Options**: Export data in CSV, JSON, or Excel formats
- **ROI Tracking**: Link AI spending to business outcomes
- **Anomaly Detection**: Identify unusual spending patterns

## API Endpoints

### Project Management

```bash
# Create a new project
POST /api/projects
{
  "name": "Marketing Campaign",
  "description": "Q4 2024 Marketing AI Usage",
  "budget": {
    "amount": 5000,
    "period": "monthly",
    "alerts": [
      { "threshold": 50, "type": "in-app" },
      { "threshold": 80, "type": "both" }
    ]
  },
  "members": [
    { "userId": "user123", "role": "admin" }
  ],
  "settings": {
    "requireApprovalAbove": 100,
    "enablePromptLibrary": true,
    "enableCostAllocation": true
  }
}

# Get user's projects
GET /api/projects

# Get project analytics
GET /api/projects/:projectId/analytics?period=monthly

# Update project settings
PUT /api/projects/:projectId

# Add team member
POST /api/projects/:projectId/members
{
  "memberId": "user456",
  "role": "member"
}

# Remove team member
DELETE /api/projects/:projectId/members/:memberId

# Get cost allocation
GET /api/projects/:projectId/cost-allocation?groupBy=department

# Export project data
GET /api/projects/:projectId/export?format=csv
```

### Approval Workflows

```bash
# Get approval requests
GET /api/projects/:projectId/approvals?status=pending

# Handle approval request
POST /api/projects/approvals/:requestId
{
  "action": "approve",
  "comments": "Approved for this campaign",
  "conditions": ["Use GPT-3.5 when possible"]
}
```

### Prompt Templates

```bash
# Create prompt template
POST /api/prompt-templates
{
  "name": "Product Description Generator",
  "content": "Generate a compelling product description for {{productName}}...",
  "category": "business",
  "variables": [
    {
      "name": "productName",
      "description": "Name of the product",
      "required": true
    }
  ],
  "sharing": {
    "visibility": "project"
  }
}

# Get templates
GET /api/prompt-templates?category=business&projectId=proj123

# Use template
POST /api/prompt-templates/:templateId/use
{
  "variables": {
    "productName": "AI Cost Optimizer Pro"
  }
}

# Fork template
POST /api/prompt-templates/:templateId/fork

# Add feedback
POST /api/prompt-templates/:templateId/feedback
{
  "rating": 5,
  "comment": "Excellent results!"
}

# Get popular templates
GET /api/prompt-templates/popular?category=coding
```

## Database Models

### Project Model
```javascript
{
  name: String,
  description: String,
  ownerId: ObjectId,
  members: [{
    userId: ObjectId,
    role: String, // owner, admin, member, viewer
    joinedAt: Date
  }],
  budget: {
    amount: Number,
    period: String, // monthly, quarterly, yearly, one-time
    startDate: Date,
    endDate: Date,
    currency: String,
    alerts: [{
      threshold: Number, // percentage
      type: String, // email, in-app, both
      recipients: [String]
    }]
  },
  spending: {
    current: Number,
    lastUpdated: Date,
    history: [{
      date: Date,
      amount: Number,
      breakdown: Object
    }]
  },
  settings: {
    requireApprovalAbove: Number,
    allowedModels: [String],
    maxTokensPerRequest: Number,
    enablePromptLibrary: Boolean,
    enableCostAllocation: Boolean
  },
  tags: [String],
  isActive: Boolean
}
```

### ApprovalRequest Model
```javascript
{
  requesterId: ObjectId,
  projectId: ObjectId,
  type: String, // api_call, bulk_operation, model_change, budget_increase
  status: String, // pending, approved, rejected, expired
  details: {
    operation: String,
    estimatedCost: Number,
    estimatedTokens: Number,
    model: String,
    prompt: String,
    reason: String,
    urgency: String // low, medium, high, critical
  },
  approval: {
    approverId: ObjectId,
    approvedAt: Date,
    comments: String,
    conditions: [String]
  },
  metadata: {
    currentProjectSpending: Number,
    budgetRemaining: Number,
    requesterHistory: Object
  },
  expiresAt: Date
}
```

### PromptTemplate Model
```javascript
{
  name: String,
  description: String,
  content: String,
  category: String,
  projectId: ObjectId,
  createdBy: ObjectId,
  version: Number,
  parentId: ObjectId, // For version control
  variables: [{
    name: String,
    description: String,
    defaultValue: String,
    required: Boolean
  }],
  metadata: {
    estimatedTokens: Number,
    estimatedCost: Number,
    recommendedModel: String,
    tags: [String],
    language: String
  },
  usage: {
    count: Number,
    lastUsed: Date,
    totalTokensSaved: Number,
    totalCostSaved: Number,
    averageRating: Number,
    feedback: [{
      userId: ObjectId,
      rating: Number,
      comment: String,
      createdAt: Date
    }]
  },
  sharing: {
    visibility: String, // private, project, organization, public
    sharedWith: [ObjectId],
    allowFork: Boolean
  },
  isActive: Boolean,
  isDeleted: Boolean
}
```

## Implementation Guide

### 1. Tracking API Calls with Projects

When making API calls through the tracker, include project information:

```javascript
// In your API call tracking
await AICostTrackerService.trackRequest(
  request,
  response,
  userId,
  {
    projectId: 'proj123',
    tags: ['marketing', 'campaign'],
    costAllocation: {
      department: 'Marketing',
      team: 'Content',
      client: 'ACME Corp'
    }
  }
);
```

### 2. Handling Approval Requirements

The system automatically checks if approval is required:

```javascript
// When estimated cost exceeds project threshold
if (estimatedCost > project.settings.requireApprovalAbove) {
  // Create approval request
  // Throw error with approval request ID
  throw new Error(`Approval required. Request ID: ${approvalRequest._id}`);
}
```

### 3. Using Prompt Templates

```javascript
// Get and use a template
const template = await PromptTemplateService.getTemplate(templateId);
const result = await PromptTemplateService.useTemplate(templateId, userId, {
  productName: 'AI Cost Optimizer',
  features: 'Cost tracking, optimization, analytics'
});

// Track the usage with template reference
await AICostTrackerService.trackRequest(
  { prompt: result.prompt, model: 'gpt-3.5-turbo' },
  response,
  userId,
  {
    projectId: 'proj123',
    promptTemplateId: templateId
  }
);
```

### 4. Budget Alert Configuration

Projects can have multiple alert thresholds:

```javascript
budget: {
  amount: 1000,
  period: 'monthly',
  alerts: [
    { threshold: 50, type: 'in-app' },        // 50% - in-app only
    { threshold: 80, type: 'both' },          // 80% - email + in-app
    { threshold: 90, type: 'both' },          // 90% - critical alert
    { threshold: 100, type: 'both' }          // 100% - budget exceeded
  ]
}
```

## Best Practices

### 1. Project Organization
- Create projects aligned with business initiatives
- Use descriptive names and tags for easy filtering
- Set realistic budgets based on historical data
- Regular review and adjustment of budgets

### 2. Team Management
- Assign appropriate roles (viewer for read-only, member for usage, admin for management)
- Regular audit of team members and permissions
- Use approval workflows for high-cost operations
- Document approval criteria and conditions

### 3. Prompt Library
- Create templates for frequently used prompts
- Include clear variable descriptions
- Tag templates appropriately for discoverability
- Regular review and optimization of templates
- Track performance metrics and iterate

### 4. Cost Allocation
- Establish clear tagging conventions
- Train team on proper cost allocation
- Regular review of allocation accuracy
- Use allocation data for budget planning

### 5. Monitoring & Alerts
- Configure alerts at multiple thresholds
- Act on alerts promptly
- Review spending patterns regularly
- Adjust budgets based on actual usage

## Security Considerations

1. **Access Control**: All operations check user permissions
2. **Data Isolation**: Projects isolate data between teams
3. **Approval Audit Trail**: All approvals are logged
4. **Export Restrictions**: Only authorized users can export data
5. **Template Security**: Private templates are only visible to creators

## ROI Measurement

Track the value delivered by AI:

1. **Cost Savings**: Monitor savings from optimizations and shared templates
2. **Efficiency Gains**: Track time saved using templates
3. **Quality Metrics**: Measure output quality improvements
4. **Business Impact**: Link AI usage to business outcomes

## Troubleshooting

### Common Issues

1. **Budget Exceeded**
   - Check current spending: `GET /api/projects/:projectId/analytics`
   - Review recent high-cost operations
   - Adjust budget or enable stricter controls

2. **Approval Delays**
   - Check pending approvals: `GET /api/projects/:projectId/approvals?status=pending`
   - Ensure admins are notified of requests
   - Consider adjusting approval thresholds

3. **Template Not Found**
   - Verify template visibility settings
   - Check user has access to template's project
   - Ensure template is not deleted

## Future Enhancements

1. **Advanced Analytics**
   - Predictive budget forecasting
   - Anomaly detection algorithms
   - Custom reporting dashboards

2. **Workflow Automation**
   - Auto-approval for trusted users
   - Scheduled budget resets
   - Automated cost optimization

3. **Integration Features**
   - Slack/Teams notifications
   - JIRA/Asana project linking
   - Accounting system integration

4. **Enhanced Governance**
   - Multi-level approval chains
   - Policy-based controls
   - Compliance reporting 