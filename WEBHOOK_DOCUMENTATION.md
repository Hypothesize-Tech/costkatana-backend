# 🪝 Webhook Documentation

## Overview
Cost Katana's webhook system allows you to receive real-time notifications when important events occur in your account. Configure endpoints to receive HTTP POST requests for events like cost alerts, optimization completions, and more.

## Webhook Endpoints

### GET `/api/webhooks/events` - Get Available Events
Retrieve all available webhook event types.

**Response:**
```json
{
  "success": true,
  "events": [
    {
      "key": "COST_ALERT",
      "value": "cost.alert",
      "category": "cost",
      "name": "alert"
    }
  ],
  "categories": ["cost", "optimization", "model", "usage", "experiment", "workflow", "security", "system", "agent", "quality"],
  "total": 45
}
```

### POST `/api/webhooks` - Create Webhook
Create a new webhook endpoint.

**Request Body:**
```json
{
  "name": "Production Alerts",
  "description": "Send alerts to our monitoring system",
  "url": "https://example.com/webhook",
  "active": true,
  "events": ["cost.alert", "budget.exceeded", "optimization.completed"],
  "auth": {
    "type": "bearer",
    "credentials": {
      "token": "your-bearer-token"
    }
  },
  "filters": {
    "severity": ["high", "critical"],
    "minCost": 50
  },
  "headers": {
    "X-Custom-Header": "value"
  },
  "timeout": 30000,
  "retryConfig": {
    "maxRetries": 5,
    "backoffMultiplier": 2,
    "initialDelay": 5000
  }
}
```

**Response:**
```json
{
  "success": true,
  "webhook": {
    "id": "webhook_123",
    "name": "Production Alerts",
    "url": "https://example.com/webhook",
    "events": ["cost.alert", "budget.exceeded", "optimization.completed"],
    "active": true,
    "secret": "****abcd",
    "createdAt": "2024-01-15T10:00:00Z"
  }
}
```

### GET `/api/webhooks` - List Webhooks
Get all configured webhooks.

**Query Parameters:**
- `active` (boolean): Filter by active status
- `events` (string[]): Filter by event types

**Response:**
```json
{
  "success": true,
  "webhooks": [
    {
      "id": "webhook_123",
      "name": "Production Alerts",
      "url": "https://example.com/webhook",
      "events": ["cost.alert"],
      "active": true,
      "stats": {
        "totalDeliveries": 150,
        "successfulDeliveries": 148,
        "failedDeliveries": 2,
        "averageResponseTime": 235
      }
    }
  ]
}
```

### GET `/api/webhooks/:id` - Get Webhook
Get details of a specific webhook.

### PUT `/api/webhooks/:id` - Update Webhook
Update an existing webhook.

### DELETE `/api/webhooks/:id` - Delete Webhook
Delete a webhook.

### POST `/api/webhooks/:id/test` - Test Webhook
Send a test event to verify webhook configuration.

**Request Body (optional):**
```json
{
  "eventType": "cost.alert",
  "customData": {
    "test": true
  }
}
```

### GET `/api/webhooks/:id/stats` - Get Webhook Statistics
Get detailed statistics for a webhook.

### GET `/api/webhooks/:id/deliveries` - Get Deliveries
Get delivery history for a webhook.

**Query Parameters:**
- `status`: Filter by delivery status (pending, success, failed)
- `eventType`: Filter by event type
- `limit`: Number of results (default: 20, max: 100)
- `offset`: Pagination offset

**Response:**
```json
{
  "success": true,
  "deliveries": [
    {
      "id": "delivery_456",
      "eventId": "evt_789",
      "eventType": "cost.alert",
      "status": "success",
      "attempt": 1,
      "request": {
        "url": "https://example.com/webhook",
        "method": "POST",
        "timestamp": "2024-01-15T10:00:00Z"
      },
      "response": {
        "statusCode": 200,
        "responseTime": 235
      }
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

### GET `/api/webhooks/deliveries/:id` - Get Delivery Details
Get detailed information about a specific delivery.

### POST `/api/webhooks/deliveries/:id/replay` - Replay Delivery
Replay a failed webhook delivery.

### GET `/api/webhooks/queue/stats` - Get Queue Statistics
Get current webhook delivery queue statistics.

## Webhook Payload Format

When an event occurs, Cost Katana sends a POST request to your webhook URL with the following payload:

```json
{
  "event_id": "evt_789abc",
  "event_type": "cost.alert",
  "occurred_at": "2024-01-15T10:00:00Z",
  "severity": "high",
  "title": "Cost Alert",
  "description": "Your monthly spending has exceeded $500",
  "resource": {
    "type": "project",
    "id": "proj_123",
    "name": "Production API"
  },
  "metrics": {
    "current": 525.50,
    "threshold": 500,
    "changePercentage": 5.1,
    "unit": "USD"
  },
  "cost": {
    "amount": 525.50,
    "currency": "USD",
    "period": "2024-01",
    "breakdown": {
      "gpt-4": 300.25,
      "claude-3": 225.25
    }
  },
  "user": {
    "id": "user_123",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "project": {
    "id": "proj_123",
    "name": "Production API"
  },
  "costkatana": {
    "version": "2.0.0",
    "environment": "production"
  }
}
```

## Webhook Security

### Signature Verification
All webhook requests include an HMAC-SHA256 signature in the `X-CostKatana-Signature` header.

**Headers:**
- `X-CostKatana-Signature`: HMAC-SHA256 signature
- `X-CostKatana-Timestamp`: Unix timestamp (milliseconds)
- `X-CostKatana-Event-Id`: Unique event identifier
- `X-CostKatana-Webhook-Id`: Your webhook ID

**Verification Example (Node.js):**
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, timestamp, signature, secret) {
  const signaturePayload = `${timestamp}.${payload}`;
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(signaturePayload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Express middleware example
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-costkatana-signature'];
  const timestamp = req.headers['x-costkatana-timestamp'];
  const secret = 'your_webhook_secret';
  
  const isValid = verifyWebhookSignature(
    req.body.toString(),
    timestamp,
    signature,
    secret
  );
  
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process webhook
  const event = JSON.parse(req.body);
  console.log('Received event:', event.event_type);
  
  res.status(200).json({ received: true });
});
```

## Event Types

### Cost & Budget Events
- `cost.alert` - Cost threshold reached
- `cost.threshold_exceeded` - Cost exceeded configured threshold
- `budget.warning` - Budget usage warning (75%+)
- `budget.exceeded` - Budget limit exceeded
- `cost.spike_detected` - Unusual cost increase detected
- `cost.anomaly_detected` - AI detected cost anomaly

### Optimization Events
- `optimization.completed` - Optimization successfully applied
- `optimization.failed` - Optimization failed
- `optimization.suggested` - New optimization available
- `optimization.applied` - Optimization was applied
- `savings.milestone_reached` - Savings milestone achieved

### Model & Performance Events
- `model.performance_degraded` - Model performance decreased
- `model.error_rate_high` - High error rate detected
- `model.latency_high` - High latency detected
- `model.quota_warning` - Approaching model quota
- `model.quota_exceeded` - Model quota exceeded

### Usage Events
- `usage.spike_detected` - Usage spike detected
- `usage.pattern_changed` - Usage pattern changed
- `token.limit_warning` - Token limit warning
- `token.limit_exceeded` - Token limit exceeded
- `api.rate_limit_warning` - API rate limit warning

### Experiment & Training Events
- `experiment.started` - Experiment started
- `experiment.completed` - Experiment completed successfully
- `experiment.failed` - Experiment failed
- `training.started` - Training started
- `training.completed` - Training completed successfully
- `training.failed` - Training failed

### Workflow Events
- `workflow.started` - Workflow execution started
- `workflow.completed` - Workflow completed successfully
- `workflow.failed` - Workflow failed
- `workflow.step_completed` - Workflow step completed

### Security & Compliance Events
- `security.alert` - Security issue detected
- `compliance.violation` - Compliance violation detected
- `data.privacy_alert` - Data privacy issue detected
- `moderation.blocked` - Content blocked by moderation

### System Events
- `system.error` - System error occurred
- `service.degradation` - Service degradation detected
- `maintenance.scheduled` - Scheduled maintenance notification

### Agent Events
- `agent.task_completed` - AI agent completed task
- `agent.task_failed` - AI agent task failed
- `agent.insight_generated` - AI agent generated new insight

### Quality Events
- `quality.degraded` - Quality metrics degraded
- `quality.improved` - Quality metrics improved
- `quality.threshold_violated` - Quality threshold violated

## Retry Logic

Failed deliveries are retried with exponential backoff:
- Initial retry: 5 seconds
- Backoff multiplier: 2x
- Maximum retries: 5
- Maximum delay: 1 hour

Example retry timeline:
1. Initial attempt: Immediate
2. First retry: 5 seconds
3. Second retry: 10 seconds
4. Third retry: 20 seconds
5. Fourth retry: 40 seconds
6. Fifth retry: 80 seconds

## Webhook Configuration Examples

### Basic Configuration
```json
{
  "name": "Simple Alert Webhook",
  "url": "https://example.com/webhook",
  "events": ["cost.alert", "budget.exceeded"]
}
```

### Advanced Configuration with Filters
```json
{
  "name": "Production Critical Alerts",
  "url": "https://api.example.com/webhooks/costkatana",
  "events": [
    "cost.threshold_exceeded",
    "budget.exceeded",
    "model.quota_exceeded",
    "system.error"
  ],
  "auth": {
    "type": "bearer",
    "credentials": {
      "token": "sk_live_abcdef123456"
    }
  },
  "filters": {
    "severity": ["high", "critical"],
    "projects": ["proj_production"],
    "minCost": 100,
    "tags": ["production", "critical"]
  },
  "headers": {
    "X-Environment": "production",
    "X-Source": "cost-katana"
  },
  "timeout": 15000,
  "retryConfig": {
    "maxRetries": 3,
    "backoffMultiplier": 3,
    "initialDelay": 10000
  }
}
```

### Custom Payload Template
```json
{
  "name": "Slack Integration",
  "url": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
  "events": ["cost.alert", "optimization.completed"],
  "useDefaultPayload": false,
  "payloadTemplate": "{\"text\": \"{{event.data.title}}\\n{{event.data.description}}\", \"username\": \"Cost Katana\", \"icon_emoji\": \":money_with_wings:\"}"
}
```

## Integration Examples

### Slack Integration
```javascript
// Cost Katana webhook configuration
{
  "name": "Slack Notifications",
  "url": "https://your-app.com/webhooks/slack",
  "events": ["cost.alert", "budget.exceeded"]
}

// Your webhook handler
app.post('/webhooks/slack', async (req, res) => {
  const event = req.body;
  
  const slackMessage = {
    text: `Cost Katana Alert: ${event.title}`,
    attachments: [{
      color: event.severity === 'critical' ? 'danger' : 'warning',
      fields: [
        { title: 'Description', value: event.description },
        { title: 'Cost', value: `$${event.cost?.amount || 0}`, short: true },
        { title: 'Project', value: event.project?.name || 'N/A', short: true }
      ]
    }]
  };
  
  await axios.post(process.env.SLACK_WEBHOOK_URL, slackMessage);
  res.status(200).send('OK');
});
```

### PagerDuty Integration
```javascript
// Your webhook handler for PagerDuty
app.post('/webhooks/pagerduty', async (req, res) => {
  const event = req.body;
  
  if (event.severity === 'critical') {
    await axios.post('https://events.pagerduty.com/v2/enqueue', {
      routing_key: process.env.PAGERDUTY_ROUTING_KEY,
      event_action: 'trigger',
      payload: {
        summary: event.title,
        severity: 'error',
        source: 'cost-katana',
        custom_details: {
          description: event.description,
          cost: event.cost,
          metrics: event.metrics
        }
      }
    });
  }
  
  res.status(200).send('OK');
});
```

## Best Practices

### 1. Respond Quickly
- Return a 2xx status code within 30 seconds
- Process webhooks asynchronously if needed
- Use queues for time-consuming operations

### 2. Implement Idempotency
- Use the `event_id` to handle duplicate deliveries
- Store processed event IDs with TTL

```javascript
const processedEvents = new Set();

app.post('/webhook', (req, res) => {
  const eventId = req.body.event_id;
  
  if (processedEvents.has(eventId)) {
    return res.status(200).json({ status: 'already_processed' });
  }
  
  processedEvents.add(eventId);
  // Process event...
  
  res.status(200).json({ status: 'processed' });
});
```

### 3. Security Best Practices
- Always verify webhook signatures
- Use HTTPS endpoints only
- Implement IP whitelisting if possible
- Log all webhook activity

### 4. Error Handling
- Return appropriate status codes:
  - 200-299: Success (no retry)
  - 500-599: Server error (will retry)
  - 400-499: Client error (no retry)
- Log errors for debugging

### 5. Monitoring
- Set up alerts for webhook failures
- Monitor response times
- Track delivery success rates
- Use the webhook statistics API

## Troubleshooting

### Common Issues

1. **Webhook not receiving events**
   - Verify the webhook is active
   - Check event types are correctly configured
   - Ensure filters aren't too restrictive
   - Test with the test endpoint

2. **Signature verification failing**
   - Ensure you're using the raw request body
   - Check the secret matches exactly
   - Verify timestamp is within 5 minutes

3. **High failure rate**
   - Check endpoint availability
   - Verify timeout settings
   - Review response times
   - Check for rate limiting

4. **Missing events**
   - Review filter configuration
   - Check severity thresholds
   - Verify project filters

### Debug Mode
Enable detailed logging for troubleshooting:

```javascript
app.post('/webhook', (req, res) => {
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('Signature:', req.headers['x-costkatana-signature']);
  
  // Your webhook logic...
});
```

## Rate Limits

- Maximum 10 webhooks per account
- Maximum 100 deliveries per minute per webhook
- Test endpoint: 5 requests per minute
- Replay endpoint: 10 requests per minute

## Support

For webhook support:
- Email: support@costkatana.com
- Documentation: https://docs.costkatana.com/webhooks
- Status Page: https://status.costkatana.com
