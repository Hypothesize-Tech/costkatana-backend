# CostKatana Integration FAQ & Troubleshooting

Comprehensive FAQ and troubleshooting guide for all CostKatana packages. This guide addresses the most common integration issues and questions developers encounter when using our packages.

## 🚨 Authentication & API Key Issues

### Q: "Authentication failed" or "Invalid API key" error
**A:** This is the most common issue. Here's how to resolve it:

**For CLI Package:**
```bash
# Check current API key
cost-katana config --get apiKey

# Verify key format (must start with 'dak_')
cost-katana config --set apiKey dak_your_actual_key_here

# Test configuration
cost-katana test
```

**For Core Package (JavaScript/TypeScript):**
```javascript
// Check if API key is properly loaded
console.log('API Key length:', process.env.COST_KATANA_API_KEY?.length);
console.log('API Key prefix:', process.env.COST_KATANA_API_KEY?.substring(0, 4));

// Verify key format
if (!process.env.COST_KATANA_API_KEY?.startsWith('dak_')) {
  throw new Error('Invalid API key format. Must start with "dak_"');
}
```

**For Python SDK:**
```python
import os
import cost_katana as ck

# Check environment variable
api_key = os.getenv('API_KEY')
print(f"API Key loaded: {api_key[:10]}..." if api_key else "No API key found")

# Validate key format
if not api_key or not api_key.startswith('dak_'):
    raise ValueError("Invalid API key. Must start with 'dak_'")
```

**Common Causes:**
- API key not starting with `dak_`
- API key expired or deactivated
- Insufficient credits in your account
- Using wrong environment (dev vs prod keys)

### Q: How do I get a CostKatana API key?
**A:**
1. Visit [costkatana.com/dashboard](https://costkatana.com/dashboard)
2. Create an account or sign in
3. Go to "API Keys" section in your dashboard
4. Click "Generate New Key"
5. Copy the key (it will start with `dak_`)

## 🔧 Installation & Import Issues

### Q: "Module not found" or "Cannot find module" errors
**A:**

**For CLI Package:**
```bash
# Global installation (recommended)
npm install -g cost-katana-cli

# Verify installation
cost-katana --version

# If still not found, check PATH
echo $PATH
# Or use npx
npx cost-katana-cli --version
```

**For Core Package:**
```bash
# Install package
npm install cost-katana

# Check installation
npm list cost-katana

# Clear npm cache if needed
npm cache clean --force
npm install cost-katana
```

**For Python SDK:**
```bash
# Install package
pip install cost-katana

# Check installation
pip list | grep cost-katana

# Verify Python path
python -c "import sys; print(sys.path)"

# Try reinstalling
pip uninstall cost-katana
pip install cost-katana
```

### Q: Import errors in TypeScript/JavaScript projects
**A:**
```typescript
// For Node.js projects
import { CostTracker } from 'cost-katana';

// For browser environments, ensure proper bundling
// Make sure you have:
// 1. "type": "module" in package.json
// 2. Proper import maps for browser
// 3. Or use a bundler like Webpack/Vite
```

## 🧠 Cortex Meta-Language Issues

### Q: Cortex optimization not working or giving errors
**A:**

**Common Issues:**
1. **Insufficient credits for Cortex processing**
2. **Model not available for Cortex pipeline**
3. **Incorrect Cortex configuration**

**Solutions:**

**For CLI:**
```bash
# Check if Cortex is enabled in config
cost-katana config --get enableOptimization

# Enable Cortex
cost-katana config --set enableOptimization true

# Try with different models
cost-katana optimize --prompt "test" --cortex --encoding-model claude-3-haiku
```

**For Core Package:**
```javascript
// Check Cortex configuration
const response = await tracker.generateContent('test', {
  cortex: {
    enabled: true,
    encodingModel: 'claude-3-haiku', // Try cheaper model first
    coreModel: 'nova-lite',
    decodingModel: 'claude-3-haiku'
  }
});
```

**For Python SDK:**
```python
# Enable Cortex with fallback models
response = model.generate_content(
    "test prompt",
    cortex={
        'enabled': True,
        'encoding_model': 'claude-3-haiku',  # Start with cheaper model
        'core_model': 'nova-lite',
        'decoding_model': 'claude-3-haiku'
    }
)
```

### Q: Cortex showing low token reduction percentages
**A:**
- **Expected**: 40-75% token reduction for most queries
- **Common reasons for lower reduction**:
  - Very short prompts (less room for optimization)
  - Simple queries that don't benefit much from Cortex
  - Technical/conversational content (Cortex works best on complex content)

**Try:**
```python
# Use answer_generation mode for better results
response = model.generate_content(
    "Complex technical explanation",
    cortex={
        'enabled': True,
        'mode': 'answer_generation',  # Better for complex content
        'context': 'technical',
        'complexity': 'high'
    }
)
```

## 📊 Cost & Budget Issues

### Q: Unexpected high costs or budget exceeded
**A:**

**Immediate Solutions:**
1. **Enable Cortex optimization** (40-75% cost reduction)
2. **Set budget limits** to prevent overspending
3. **Monitor usage patterns**

**For CLI:**
```bash
# Enable Cortex and set budget
cost-katana set-budget --project my-project --cost 50 --notify webhook --webhook-url https://your-webhook.com
cost-katana optimize --prompt "your query" --cortex
```

**For Core Package:**
```javascript
// Enable Cortex and set cost limits
const tracker = new CostTracker({
  apiKey: 'dak_your_key_here',
  costLimitPerDay: 50.0,
  enableCortex: true
});
```

**For Python SDK:**
```python
# Set cost limits and enable Cortex
ck.configure(
    api_key='dak_your_key_here',
    cost_limit_per_day=50.0
)

model = ck.GenerativeModel('nova-lite')
response = model.generate_content(
    "your query",
    cortex={'enabled': True}
)
```

### Q: How to monitor and track costs effectively?
**A:**

**Real-time Monitoring:**

**For CLI:**
```bash
# Daily usage analysis
cost-katana analyze --days 1

# Set up budget alerts
cost-katana set-budget --project my-project --cost 100 --notify email

# Export usage data
cost-katana analyze --format csv --export usage-report.csv
```

**For Core Package:**
```javascript
// Monitor costs in your application
class CostMonitor {
  private totalCost = 0;

  async makeRequest(prompt: string) {
    const response = await tracker.generateContent(prompt);
    this.totalCost += response.usage_metadata.cost;

    console.log(`Cost: $${response.usage_metadata.cost}, Total: $${this.totalCost}`);

    if (this.totalCost > 50.0) {
      await this.sendBudgetAlert();
    }

    return response;
  }
}
```

**For Python SDK:**
```python
# Track costs and send alerts
class CostTracker:
    def __init__(self, budget_limit: float = 50.0):
        self.budget_limit = budget_limit
        self.total_cost = 0.0

    def make_request(self, prompt: str):
        response = model.generate_content(prompt)
        self.total_cost += response.usage_metadata.cost

        print(f"Cost: ${response.usage_metadata.cost:.4f}, Total: ${self.total_cost:.4f}")

        if self.total_cost > self.budget_limit:
            self.send_alert()

        return response
```

## 🔄 Model & Provider Issues

### Q: "Model not available" or "Service unavailable" errors
**A:**

**Troubleshooting Steps:**
1. **Check model name spelling** (case-sensitive)
2. **Verify model availability**
3. **Try alternative models**
4. **Check service status**

**For CLI:**
```bash
# List available models
cost-katana list-models

# Try alternative model
cost-katana optimize --prompt "test" --model nova-micro

# Check specific provider
cost-katana list-models --provider anthropic
```

**For Core Package:**
```javascript
// Try fallback models
const models = ['nova-lite', 'claude-3-haiku', 'gpt-3.5-turbo'];

for (const modelName of models) {
  try {
    const response = await tracker.generateContent('test', { model: modelName });
    console.log(`Success with ${modelName}`);
    break;
  } catch (error) {
    console.log(`Failed with ${modelName}: ${error.message}`);
  }
}
```

**For Python SDK:**
```python
# Try multiple models with fallbacks
models_to_try = ['nova-lite', 'claude-3-haiku', 'gpt-3.5-turbo']

for model_name in models_to_try:
    try:
        model = ck.GenerativeModel(model_name)
        response = model.generate_content("test prompt")
        print(f"Success with {model_name}")
        break
    except Exception as e:
        print(f"Failed with {model_name}: {e}")
```

### Q: Which model should I use for different tasks?
**A:**

**Model Selection Guide:**

| Task Type | Recommended Models | Rationale |
|-----------|------------------|-----------|
| **Simple queries** | `nova-micro`, `claude-3-haiku` | Fast and cost-effective |
| **General use** | `nova-lite`, `claude-3-sonnet`, `gpt-4` | Balanced performance/cost |
| **Complex tasks** | `nova-pro`, `claude-3-opus`, `gpt-4-turbo` | Maximum capabilities |
| **Code generation** | `claude-3-sonnet`, `gpt-4` | Better code understanding |
| **Creative tasks** | `gpt-4`, `claude-3-opus` | Better creativity |
| **Analysis tasks** | `claude-3-opus`, `gemini-2.0-flash` | Better reasoning |

**Quick Selection:**
```python
# Choose model based on task complexity
def select_model(task_type: str) -> str:
    model_map = {
        'simple': 'nova-micro',
        'general': 'nova-lite',
        'complex': 'nova-pro',
        'code': 'claude-3-sonnet',
        'creative': 'gpt-4'
    }
    return model_map.get(task_type, 'nova-lite')
```

## 🚨 Error Handling & Retry Logic

### Q: How to implement proper retry logic?
**A:**

**Exponential Backoff Pattern:**

```python
import asyncio
import random

async def retry_with_backoff(func, max_retries=3, base_delay=1, max_delay=60):
    """Retry function with exponential backoff."""
    for attempt in range(max_retries):
        try:
            return await func()
        except Exception as e:
            if attempt == max_retries - 1:
                raise e

            delay = min(base_delay * (2 ** attempt) + random.uniform(0, 1), max_delay)
            print(f"Attempt {attempt + 1} failed, retrying in {delay:.2f}s...")
            await asyncio.sleep(delay)

# Usage
async def robust_request():
    return await retry_with_backoff(
        lambda: model.generate_content("your prompt")
    )
```

**For JavaScript/TypeScript:**
```javascript
async function retryWithBackoff(func, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await func();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;

      const delay = Math.min(baseDelay * Math.pow(2, attempt), 30000);
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### Q: How to handle rate limiting properly?
**A:**

**Rate Limit Handling:**

```python
import time
from cost_katana.exceptions import RateLimitError

def handle_rate_limits(func, max_retries=3):
    """Handle rate limiting with intelligent backoff."""
    for attempt in range(max_retries):
        try:
            return func()
        except RateLimitError as e:
            if attempt == max_retries - 1:
                raise e

            # Exponential backoff with jitter
            wait_time = min((2 ** attempt) * 5 + random.uniform(0, 3), 60)
            print(f"Rate limited. Waiting {wait_time:.1f} seconds...")
            time.sleep(wait_time)
        except Exception as e:
            # Re-raise non-rate-limit errors immediately
            raise e
```

## 🔒 Security & Best Practices

### Q: How to securely store API keys?
**A:**

**Recommended Approaches:**

1. **Environment Variables** (Most Secure):
```bash
# .env file (never commit to version control)
API_KEY=dak_your_actual_key_here

# Load in application
import os
api_key = os.getenv('API_KEY')
```

2. **Secret Management Systems**:
```python
# AWS Secrets Manager
import boto3
from botocore.exceptions import ClientError

def get_secret():
    secret_name = "cost-katana-api-key"
    region_name = "us-east-1"

    session = boto3.session.Session()
    client = session.client(service_name='secretsmanager', region_name=region_name)

    try:
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
        return get_secret_value_response['SecretString']
    except ClientError as e:
        raise e
```

3. **Docker Secrets**:
```yaml
# docker-compose.yml
services:
  app:
    environment:
      API_KEY_FILE: /run/secrets/API_KEY
    secrets:
      - API_KEY
```

### Q: How to validate and sanitize user inputs?
**A:**

**Input Validation:**

```python
import re
import json

def validate_prompt(prompt: str) -> str:
    """Validate and sanitize user prompts."""

    # Type checking
    if not isinstance(prompt, str):
        raise ValueError("Prompt must be a string")

    # Length validation
    if len(prompt) > 100000:
        raise ValueError("Prompt too long (max 100,000 characters)")

    if len(prompt.strip()) == 0:
        raise ValueError("Prompt cannot be empty")

    # Basic sanitization
    # Remove potentially harmful content
    sanitized = re.sub(r'<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>', '', prompt, flags=re.IGNORECASE)
    sanitized = re.sub(r'javascript:', '', sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r'on\w+\s*=', '', sanitized, flags=re.IGNORECASE)

    return sanitized.strip()

def validate_model_name(model_name: str) -> str:
    """Validate model name against allowed list."""
    allowed_models = [
        'nova-micro', 'nova-lite', 'nova-pro',
        'claude-3-haiku', 'claude-3-sonnet', 'claude-3-opus',
        'gpt-4', 'gpt-4-turbo-preview', 'gpt-3.5-turbo'
    ]

    if model_name not in allowed_models:
        raise ValueError(f"Invalid model: {model_name}")

    return model_name
```

## 🚀 Performance & Optimization

### Q: How to optimize for performance and cost?
**A:**

**Performance Optimization Strategies:**

1. **Model Selection**:
```python
# Choose fastest models for simple tasks
fast_models = ['nova-micro', 'claude-3-haiku']
balanced_models = ['nova-lite', 'claude-3-sonnet']
powerful_models = ['nova-pro', 'claude-3-opus']
```

2. **Cortex Optimization**:
```python
# Always enable Cortex for production
response = model.generate_content(
    "your query",
    cortex={
        'enabled': True,
        'mode': 'answer_generation'
    }
)
```

3. **Batch Processing**:
```python
# Process multiple queries efficiently
queries = ["query1", "query2", "query3"]
results = model.bulk_generate_content(queries, cortex={'enabled': True})
```

4. **Caching**:
```python
# Implement response caching
cache = {}

def get_cached_response(prompt: str):
    if prompt in cache:
        return cache[prompt]

    response = model.generate_content(prompt)
    cache[prompt] = response
    return response
```

### Q: How to handle large responses or long-running requests?
**A:**

**For Long Responses:**

```python
# Set appropriate limits
response = model.generate_content(
    "long query",
    generation_config={
        'max_output_tokens': 2000,
        'temperature': 0.7
    }
)

# For very long content, consider streaming (if available)
# Note: Streaming support varies by package and provider
```

**For Timeout Handling:**

```python
import asyncio

async def generate_with_timeout(prompt: str, timeout: int = 60):
    """Generate content with timeout."""
    try:
        response = await asyncio.wait_for(
            model.generate_content(prompt),
            timeout=timeout
        )
        return response
    except asyncio.TimeoutError:
        raise TimeoutError(f"Request timed out after {timeout} seconds")
```

## 🛠️ Development & Debugging

### Q: How to enable debug mode and logging?
**A:**

**For CLI:**
```bash
# Enable verbose logging
cost-katana optimize --prompt "test" --verbose --debug

# Test with minimal prompt
cost-katana test --verbose
```

**For Core Package:**
```javascript
// Enable debug mode
const tracker = new CostTracker({
  apiKey: 'dak_your_key_here',
  debug: true,
  logLevel: 'debug'
});
```

**For Python SDK:**
```python
import logging

# Enable debug logging
logging.basicConfig(level=logging.DEBUG)

# Configure SDK with debug
ck.configure(
    api_key='dak_your_key_here',
    debug=True
)
```

### Q: How to test integration without making actual API calls?
**A:**

**Mock Testing:**

```python
# Python SDK - Mock for testing
class MockCostKatana:
    def generate_content(self, prompt):
        return type('Response', (), {
            'text': f"Mock response for: {prompt}",
            'usage_metadata': type('Metadata', (), {
                'cost': 0.001,
                'tokens': 10,
                'model': 'mock-model'
            })()
        })()

# Use in tests
def test_my_function():
    # Replace actual SDK with mock
    import sys
    original_module = sys.modules['cost_katana']
    sys.modules['cost_katana'] = MockCostKatana()

    # Run your tests
    result = my_function_that_uses_cost_katana()

    # Restore original module
    sys.modules['cost_katana'] = original_module
```

## 🔄 Migration Issues

### Q: How to migrate from direct provider SDKs?
**A:**

**From OpenAI to CostKatana:**

```python
# Before (OpenAI)
import openai

openai.api_key = "your-openai-key"
response = openai.ChatCompletion.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)

# After (CostKatana)
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')
model = ck.GenerativeModel('gpt-4')
response = model.generate_content("Hello")
```

**From Anthropic to CostKatana:**

```javascript
// Before (Anthropic)
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: 'your-key' });
const response = await anthropic.messages.create({
  model: 'claude-3-sonnet-20240229-v1:0',
  messages: [{ role: 'user', content: 'Hello' }],
});

// After (CostKatana)
const { CostTracker } = require('cost-katana');

const tracker = new CostTracker({ apiKey: 'dak_your_key_here' });
const response = await tracker.generateContent('Hello', {
  model: 'claude-3-sonnet'
});
```

### Q: What are the main benefits of migrating to CostKatana?
**A:**

**Key Benefits:**
1. **Unified API**: One interface for all AI providers
2. **Cost Optimization**: 40-75% token reduction with Cortex
3. **Automatic Failover**: Seamless provider switching
4. **Built-in Analytics**: Real-time cost tracking
5. **Enterprise Features**: Team management, budgets, audit logs

## 📋 Quick Troubleshooting Checklist

### Before Contacting Support:

1. **✅ Verify API Key**
   - Check key format (starts with `dak_`)
   - Verify key is active in dashboard
   - Ensure sufficient credits

2. **✅ Test Basic Functionality**
   ```bash
   # CLI
   cost-katana test

   # Python
   python -c "import cost_katana as ck; ck.configure(api_key='test'); print('OK')"

   # JavaScript
   node -e "const { CostTracker } = require('cost-katana'); console.log('OK')"
   ```

3. **✅ Check Network Connectivity**
   ```bash
   curl -H "Authorization: Bearer $API_KEY" https://api.costkatana.com/health
   ```

4. **✅ Try Alternative Models**
   ```python
   # Test with different models
   models = ['nova-micro', 'claude-3-haiku', 'gpt-3.5-turbo']
   for model in models:
       try:
           response = ck.GenerativeModel(model).generate_content("test")
           print(f"Success with {model}")
           break
       except Exception as e:
           print(f"Failed with {model}: {e}")
   ```

5. **✅ Enable Cortex Optimization**
   ```python
   # Test with Cortex enabled
   response = model.generate_content("test", cortex={'enabled': True})
   ```

## 🆘 Getting Additional Help

### Support Channels:
- **📖 Documentation**: [docs.costkatana.com](https://docs.costkatana.com)
- **💬 Discord Community**: [discord.gg/costkatana](https://discord.gg/D8nDArmKbY)
- **📧 Email Support**: support@costkatana.com
- **🐛 GitHub Issues**: [github.com/cost-katana](https://github.com/cost-katana)

### When to Contact Support:
- API key issues that persist after verification
- Billing or account-related problems
- Service outages or availability issues
- Feature requests or enhancement suggestions
- Complex integration challenges

---

**Still having issues?** Don't hesitate to reach out to our support team. We're here to help you succeed with CostKatana! 🚀

