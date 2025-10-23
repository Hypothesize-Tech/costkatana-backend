# CostKatana Core Package Integration Guide

Comprehensive guide for integrating the `ai-cost-tracker` package into your JavaScript/TypeScript applications.

## 📦 Installation & Setup

### NPM Installation
```bash
# For Node.js projects
npm install ai-cost-tracker

# For TypeScript projects (includes type definitions)
npm install --save-dev @types/ai-cost-tracker
```

### Yarn Installation
```bash
# Yarn package manager
yarn add ai-cost-tracker

# For TypeScript support
yarn add --dev @types/ai-cost-tracker
```

### Verify Installation
```bash
node -e "console.log('Testing import...'); const { CostTracker } = require('ai-cost-tracker'); console.log('Import successful!');"
```

## 🚀 Quick Start Integration

### Basic Setup
```javascript
// CommonJS (Node.js)
const { CostTracker } = require('ai-cost-tracker');

// ES6 Modules (Modern JavaScript/TypeScript)
import { CostTracker } from 'ai-cost-tracker';

// Initialize with API key
const tracker = new CostTracker({
  apiKey: 'dak_your_key_here',
  defaultModel: 'nova-lite'
});
```

### Basic Usage
```javascript
// Generate content with cost tracking
async function example() {
  try {
    const response = await tracker.generateContent('Hello, world!');

    console.log('Generated text:', response.text);
    console.log('Cost:', `$${response.usage_metadata.cost}`);
    console.log('Tokens used:', response.usage_metadata.total_tokens);
    console.log('Latency:', `${response.usage_metadata.latency}s`);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

example();
```

### TypeScript Integration
```typescript
import { CostTracker, GenerateContentResponse } from 'ai-cost-tracker';

interface AppConfig {
  apiKey: string;
  defaultModel: string;
  costLimit?: number;
}

class AICostManager {
  private tracker: CostTracker;

  constructor(config: AppConfig) {
    this.tracker = new CostTracker({
      apiKey: config.apiKey,
      defaultModel: config.defaultModel,
      costLimitPerDay: config.costLimit || 50.0
    });
  }

  async generateResponse(prompt: string): Promise<GenerateContentResponse> {
    return await this.tracker.generateContent(prompt);
  }

  async getUsageStats() {
    // Implementation for usage statistics
    return await this.tracker.getUsageStats();
  }
}

// Usage
const aiManager = new AICostManager({
  apiKey: process.env.API_KEY!,
  defaultModel: 'claude-3-sonnet',
  costLimit: 100.0
});

const response = await aiManager.generateResponse('Explain quantum computing');
```

## 🧠 Cortex Meta-Language Integration

### Basic Cortex Usage
```javascript
// Enable Cortex for massive token savings (70-95% reduction)
const response = await tracker.generateContent(
  'Write a complete Python web scraper',
  {
    cortex: {
      enabled: true,
      mode: 'answer_generation',
      encodingModel: 'claude-3-5-sonnet',
      coreModel: 'claude-opus-4-1',
      decodingModel: 'claude-3-5-sonnet',
      dynamicInstructions: true,
      analytics: true
    }
  }
);

console.log(`Token reduction: ${response.cortex_metadata.token_reduction}%`);
console.log(`Cost savings: $${response.cortex_metadata.cost_savings}`);
console.log(`Confidence: ${response.cortex_metadata.confidence}%`);
```

### Advanced Cortex Configuration
```javascript
// Context-aware Cortex processing
const technicalResponse = await tracker.generateContent(
  'Implement a distributed caching system with Redis',
  {
    cortex: {
      enabled: true,
      context: 'technical',
      complexity: 'high',
      includeExamples: true,
      codeGeneration: true,
      preserveFormatting: true,
      maxIterations: 3
    }
  }
);

// Bulk Cortex optimization
const queries = [
  'Explain machine learning algorithms',
  'Write a React authentication component',
  'Create a database migration script'
];

const results = await Promise.all(
  queries.map(query =>
    tracker.generateContent(query, {
      cortex: {
        enabled: true,
        mode: 'answer_generation',
        batchProcessing: true,
        dynamicInstructions: true
      }
    })
  )
);

results.forEach((result, index) => {
  console.log(`Query ${index + 1}: ${result.cortex_metadata.token_reduction}% reduction`);
});
```

## 🔧 Advanced Integration Patterns

### Chat Sessions
```javascript
// Start a conversation
const chat = tracker.startChat({
  model: 'claude-3-sonnet',
  temperature: 0.7,
  systemPrompt: 'You are a helpful coding assistant.'
});

// Multi-turn conversation
const response1 = await chat.sendMessage("Hello! What's your name?");
console.log('AI:', response1.text);

const response2 = await chat.sendMessage("Can you help me write a Python function?");
console.log('AI:', response2.text);

// Get conversation history
const history = chat.getHistory();
console.log('Conversation history:', history);

// Calculate total cost
const totalCost = chat.getTotalCost();
console.log(`Total conversation cost: $${totalCost}`);
```

### Multi-Agent Processing
```javascript
// Enable multi-agent processing for complex queries
const response = await tracker.generateContent(
  'Analyze the economic impact of AI on job markets by 2030',
  {
    useMultiAgent: true,
    chatMode: 'balanced', // 'fastest', 'cheapest', 'balanced'
    maxAgents: 3
  }
);

console.log('Agent path:', response.usage_metadata.agent_path);
console.log('Optimizations applied:', response.usage_metadata.optimizations_applied);
console.log('Risk level:', response.usage_metadata.risk_level);
```

### Custom Generation Configuration
```javascript
import { GenerationConfig } from 'ai-cost-tracker';

// Create custom configuration
const config = new GenerationConfig({
  temperature: 0.3,
  maxOutputTokens: 1000,
  topP: 0.9,
  topK: 40,
  stopSequences: ['\n\nHuman:', '\n\nAssistant:']
});

// Use with specific requests
const response = await tracker.generateContent(
  'Write a haiku about programming',
  {
    generationConfig: config,
    model: 'claude-3-sonnet'
  }
);
```

## 📊 Cost Tracking & Analytics

### Real-time Cost Monitoring
```javascript
// Monitor costs in real-time
class CostMonitor {
  private totalCost = 0;
  private requestCount = 0;

  async makeRequest(prompt: string) {
    const response = await tracker.generateContent(prompt);

    this.totalCost += response.usage_metadata.cost;
    this.requestCount++;

    console.log(`Request ${this.requestCount}:`);
    console.log(`  Cost: $${response.usage_metadata.cost}`);
    console.log(`  Total Cost: $${this.totalCost}`);
    console.log(`  Model: ${response.usage_metadata.model}`);
    console.log(`  Cache Hit: ${response.usage_metadata.cache_hit}`);

    return response;
  }

  getStats() {
    return {
      totalCost: this.totalCost,
      requestCount: this.requestCount,
      averageCost: this.totalCost / this.requestCount
    };
  }
}

const monitor = new CostMonitor();
await monitor.makeRequest('Explain quantum computing');
await monitor.makeRequest('Write a Python function');

console.log('Session stats:', monitor.getStats());
```

### Usage Analytics Integration
```javascript
// Integrate with your analytics system
async function trackUsage(requestId: string, prompt: string, response: any) {
  const analyticsData = {
    requestId,
    timestamp: new Date().toISOString(),
    promptLength: prompt.length,
    responseLength: response.text.length,
    cost: response.usage_metadata.cost,
    tokens: response.usage_metadata.total_tokens,
    model: response.usage_metadata.model,
    latency: response.usage_metadata.latency,
    cacheHit: response.usage_metadata.cache_hit
  };

  // Send to your analytics service
  await sendToAnalytics(analyticsData);

  // Check budget limits
  if (response.usage_metadata.cost > 10.0) {
    await sendBudgetAlert(requestId, response.usage_metadata.cost);
  }
}
```

## 🔄 Provider Integration Examples

### OpenAI Integration
```javascript
// Seamless integration with existing OpenAI code
async function migrateFromOpenAI() {
  // Before: Direct OpenAI SDK
  // const response = await openai.createChatCompletion({...});

  // After: CostKatana with OpenAI models
  const response = await tracker.generateContent(
    'Your prompt here',
    {
      model: 'gpt-4', // or 'gpt-4-turbo', 'gpt-3.5-turbo'
      temperature: 0.7,
      maxTokens: 1000
    }
  );

  return response.text;
}
```

### Anthropic Integration
```javascript
// Anthropic Claude integration
const claudeResponse = await tracker.generateContent(
  'Explain quantum computing in simple terms',
  {
    model: 'claude-3-sonnet', // or 'claude-3-haiku', 'claude-3-opus'
    temperature: 0.5,
    systemPrompt: 'You are a helpful teacher explaining complex topics simply.'
  }
);

console.log('Claude response:', claudeResponse.text);
console.log('Cost:', `$${claudeResponse.usage_metadata.cost}`);
```

### Google Gemini Integration
```javascript
// Google Gemini integration
const geminiResponse = await tracker.generateContent(
  'Write a comprehensive business plan',
  {
    model: 'gemini-2.0-flash', // or 'gemini-pro', 'gemini-pro-vision'
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 2000,
      topK: 40,
      topP: 0.8
    }
  }
);
```

## 🚨 Error Handling & Retry Logic

### Comprehensive Error Handling
```javascript
import { CostLimitExceededError, ModelNotAvailableError, RateLimitError } from 'ai-cost-tracker';

async function robustAIRequest(prompt: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await tracker.generateContent(prompt, {
        timeout: 30000, // 30 second timeout
        retryOnFailure: true
      });

      return response;

    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);

      if (error instanceof CostLimitExceededError) {
        console.error('Budget exceeded! Please check your limits.');
        await sendBudgetExceededAlert();
        break;
      }

      if (error instanceof ModelNotAvailableError) {
        console.log('Model unavailable, trying fallback...');
        // Try with a different model
        try {
          return await tracker.generateContent(prompt, {
            model: 'nova-lite' // Fallback model
          });
        } catch (fallbackError) {
          console.error('Fallback also failed:', fallbackError.message);
        }
      }

      if (error instanceof RateLimitError) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff
        console.log(`Rate limited. Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (attempt === maxRetries) {
        throw new Error(`All ${maxRetries} attempts failed. Last error: ${error.message}`);
      }
    }
  }
}
```

### Custom Error Classes
```typescript
// Extend for application-specific errors
export class AIServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean = false,
    public metadata?: any
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

// Usage in error handling
try {
  const response = await tracker.generateContent(userPrompt);
} catch (error) {
  if (error instanceof AIServiceError) {
    // Handle application-specific AI errors
    if (error.retryable) {
      // Implement retry logic
    } else {
      // Show user-friendly error message
    }
  } else {
    // Handle other errors
    console.error('Unexpected error:', error);
  }
}
```

## 🔒 Security & Best Practices

### Secure API Key Management
```javascript
// Environment-based configuration (recommended)
const config = {
  apiKey: process.env.API_KEY,
  baseUrl: process.env.COST_KATANA_BASE_URL || 'https://cost-katana-backend.store',
  defaultModel: process.env.COST_KATANA_DEFAULT_MODEL || 'nova-lite',
  costLimitPerDay: parseFloat(process.env.COST_KATANA_COST_LIMIT || '50.0'),
  enableAnalytics: process.env.NODE_ENV === 'production'
};

// Validate configuration
if (!config.apiKey || !config.apiKey.startsWith('dak_')) {
  throw new Error('Invalid or missing API key. Must start with "dak_"');
}
```

### Request Validation
```javascript
// Input sanitization and validation
function validatePrompt(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string');
  }

  if (prompt.length > 100000) { // Reasonable limit
    throw new Error('Prompt too long. Maximum 100,000 characters allowed.');
  }

  // Remove potentially harmful content
  const sanitized = prompt.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  return sanitized.trim();
}

// Usage
app.post('/api/generate', async (req, res) => {
  try {
    const sanitizedPrompt = validatePrompt(req.body.prompt);

    const response = await tracker.generateContent(sanitizedPrompt, {
      model: req.body.model || 'nova-lite',
      temperature: Math.max(0, Math.min(2, req.body.temperature || 0.7))
    });

    res.json({
      text: response.text,
      cost: response.usage_metadata.cost,
      tokens: response.usage_metadata.total_tokens
    });

  } catch (error) {
    res.status(400).json({
      error: error.message,
      code: error.code || 'GENERATION_ERROR'
    });
  }
});
```

## 🚀 Production Deployment

### Docker Integration
```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# Use non-root user for security
USER node

EXPOSE 3000
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  ai-service:
    build: .
    environment:
      - API_KEY=${API_KEY}
      - COST_KATANA_BASE_URL=${COST_KATANA_BASE_URL}
      - COST_KATANA_DEFAULT_MODEL=${COST_KATANA_DEFAULT_MODEL}
      - COST_KATANA_COST_LIMIT=${COST_KATANA_COST_LIMIT}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Kubernetes Deployment
```yaml
# k8s-deployment.yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-cost-tracker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ai-cost-tracker
  template:
    metadata:
      labels:
        app: ai-cost-tracker
    spec:
      containers:
      - name: ai-cost-tracker
        image: your-registry/ai-cost-tracker:latest
        env:
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: cost-katana-secrets
              key: api-key
        ports:
        - containerPort: 3000
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

## 📋 Integration Checklist

- [ ] Install `ai-cost-tracker` package
- [ ] Set up secure API key management
- [ ] Configure environment variables or config object
- [ ] Test basic functionality with simple prompts
- [ ] Implement comprehensive error handling
- [ ] Add retry logic with exponential backoff
- [ ] Set up cost monitoring and alerting
- [ ] Enable Cortex optimization for production
- [ ] Implement request validation and sanitization
- [ ] Add logging for debugging and monitoring
- [ ] Test migration from existing provider SDKs
- [ ] Set up health checks for production deployment

## 🆘 Troubleshooting Guide

### Common Issues & Solutions

#### 1. Module Resolution Errors
**Problem**: `Cannot find module 'ai-cost-tracker'`
**Solutions**:
- Verify installation: `npm list ai-cost-tracker`
- Check Node.js version compatibility (>= 18.0.0)
- Clear npm cache: `npm cache clean --force`

#### 2. Authentication Failures
**Problem**: `Authentication failed` or `Invalid API key`
**Solutions**:
- Verify API key format (must start with `dak_`)
- Check key validity in dashboard
- Ensure sufficient credits remaining
- Test with minimal prompt first

#### 3. High Memory Usage
**Problem**: Application using excessive memory
**Solutions**:
- Implement response streaming for large outputs
- Set appropriate `maxOutputTokens` limits
- Monitor and limit concurrent requests
- Use `nova-micro` or `nova-lite` for simple tasks

#### 4. Slow Response Times
**Problem**: Requests taking too long to complete
**Solutions**:
- Check network connectivity to CostKatana API
- Use appropriate models for task complexity
- Implement request timeouts (30-60 seconds)
- Consider using faster models like `nova-micro`

#### 5. Unexpected Costs
**Problem**: Costs higher than expected
**Solutions**:
- Enable Cortex optimization (`cortex.enabled: true`)
- Set cost limits and budget alerts
- Monitor usage patterns regularly
- Use appropriate models for task complexity

---

**Need help with Core package integration?** Visit [docs.costkatana.com](https://docs.costkatana.com) or join our [Discord community](https://discord.gg/D8nDArmKbY) 🚀

