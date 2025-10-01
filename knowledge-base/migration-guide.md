# CostKatana Migration Guide

Step-by-step guide for migrating from direct AI provider SDKs to CostKatana packages. This guide covers migration from OpenAI, Anthropic, Google Gemini, and other popular AI SDKs.

## 🚀 Why Migrate to CostKatana?

### Key Benefits of Migration

| Feature | Before (Direct SDKs) | After (CostKatana) |
|---------|---------------------|-------------------|
| **API Keys** | Multiple keys for each provider | Single `dak_` key for all providers |
| **Cost Optimization** | Manual optimization | 70-95% token reduction with Cortex |
| **Failover** | Manual error handling | Automatic provider switching |
| **Analytics** | No built-in tracking | Real-time cost and usage analytics |
| **Budget Management** | Manual tracking | Automated budget limits and alerts |
| **Multi-Provider** | Provider lock-in | Unified API for all providers |

### Migration Effort
- **Easy**: Basic API replacements (1-2 hours)
- **Medium**: Adding cost tracking and error handling (2-4 hours)
- **Advanced**: Full Cortex optimization and analytics (4-8 hours)

## 🔄 Migration from OpenAI SDK

### Before (OpenAI)
```python
# requirements.txt
openai>=1.0.0

# Your code
import openai

# Configure OpenAI
openai.api_key = "sk-your-openai-key-here"

# Simple completion
response = openai.ChatCompletion.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello, world!"}
    ],
    temperature=0.7,
    max_tokens=1000
)

print(response.choices[0].message.content)
print(f"Cost: ${response.usage.total_tokens * 0.03 / 1000:.4f}")  # Manual calculation
```

### After (CostKatana)
```python
# requirements.txt
cost-katana>=2.0.0

# Your code
import cost_katana as ck

# One-time configuration
ck.configure(api_key='dak_your_costkatana_key_here')

# Simple completion (same interface, better features)
model = ck.GenerativeModel('gpt-4')
response = model.generate_content(
    "Hello, world!",
    temperature=0.7,
    max_output_tokens=1000
)

print(response.text)
print(f"Cost: ${response.usage_metadata.cost:.4f}")  # Automatic calculation
print(f"Tokens: {response.usage_metadata.total_tokens}")
```

### Migration Steps for OpenAI

1. **Install CostKatana**
```bash
pip install cost-katana
```

2. **Replace API Key Management**
```python
# Before
openai.api_key = "sk-your-key"

# After
ck.configure(api_key='dak_your_key_here')
```

3. **Update Model Instantiation**
```python
# Before
response = openai.ChatCompletion.create(model="gpt-4", ...)

# After
model = ck.GenerativeModel('gpt-4')
response = model.generate_content(...)
```

4. **Update Response Handling**
```python
# Before
text = response.choices[0].message.content
cost = response.usage.total_tokens * 0.03 / 1000  # Manual calculation

# After
text = response.text
cost = response.usage_metadata.cost  # Automatic calculation
```

5. **Add Error Handling and Retry Logic**
```python
# Before - Basic error handling
try:
    response = openai.ChatCompletion.create(...)
except Exception as e:
    print(f"Error: {e}")

# After - Comprehensive error handling
from cost_katana.exceptions import RateLimitError, ModelNotAvailableError

try:
    response = model.generate_content(...)
except RateLimitError:
    # Automatic retry with backoff
    response = model.generate_content(...)
except ModelNotAvailableError:
    # Automatic failover to alternative model
    model = ck.GenerativeModel('gpt-3.5-turbo')
    response = model.generate_content(...)
```

## 🔄 Migration from Anthropic SDK

### Before (Anthropic)
```javascript
// package.json
"@anthropic-ai/sdk": "^0.15.0"

// Your code
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: 'your-anthropic-key-here',
});

const response = await anthropic.messages.create({
  model: 'claude-3-sonnet-20240229-v1:0',
  max_tokens: 1000,
  temperature: 0.7,
  messages: [
    { role: 'user', content: 'Hello, world!' }
  ],
});

console.log(response.content[0].text);
// Manual cost calculation required
```

### After (CostKatana)
```javascript
// package.json
"ai-cost-tracker": "^1.5.0"

// Your code
import { CostTracker } from 'ai-cost-tracker';

const tracker = new CostTracker({
  apiKey: 'dak_your_costkatana_key_here'
});

const response = await tracker.generateContent('Hello, world!', {
  model: 'claude-3-sonnet',
  maxTokens: 1000,
  temperature: 0.7
});

console.log(response.text);
console.log(`Cost: $${response.usage_metadata.cost}`);
```

### Migration Steps for Anthropic

1. **Install CostKatana Core Package**
```bash
npm install ai-cost-tracker
```

2. **Replace SDK Initialization**
```javascript
// Before
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({ apiKey: 'your-key' });

// After
import { CostTracker } from 'ai-cost-tracker';
const tracker = new CostTracker({ apiKey: 'dak_your_key_here' });
```

3. **Update API Calls**
```javascript
// Before
const response = await anthropic.messages.create({
  model: 'claude-3-sonnet-20240229-v1:0',
  max_tokens: 1000,
  messages: [{ role: 'user', content: 'Hello!' }],
});

// After
const response = await tracker.generateContent('Hello!', {
  model: 'claude-3-sonnet',
  maxTokens: 1000
});
```

4. **Add Cost Tracking**
```javascript
// Before - No cost tracking
console.log(response.content[0].text);

// After - Automatic cost tracking
console.log(response.text);
console.log(`Cost: $${response.usage_metadata.cost}`);
console.log(`Model: ${response.usage_metadata.model}`);
```

## 🔄 Migration from Google Gemini SDK

### Before (Google Gemini)
```python
# requirements.txt
google-generativeai>=0.3.0

# Your code
import google.generativeai as genai

# Configure Google AI
genai.configure(api_key="your-google-api-key")

# Create model
model = genai.GenerativeModel('gemini-2.0-flash')

# Generate content
response = model.generate_content(
    "Hello, world!",
    generation_config=genai.GenerateContentConfig(
        temperature=0.7,
        max_output_tokens=1000
    )
)

print(response.text)
# No built-in cost tracking
```

### After (CostKatana)
```python
# requirements.txt
cost-katana>=2.0.0

# Your code
import cost_katana as ck

# One-time configuration
ck.configure(api_key='dak_your_costkatana_key_here')

# Create model (same interface)
model = ck.GenerativeModel('gemini-2.0-flash')

# Generate content with cost tracking
response = model.generate_content(
    "Hello, world!",
    generation_config={
        'temperature': 0.7,
        'max_output_tokens': 1000
    }
)

print(response.text)
print(f"Cost: ${response.usage_metadata.cost:.4f}")
```

### Migration Steps for Google Gemini

1. **Install CostKatana**
```bash
pip install cost-katana
```

2. **Replace Configuration**
```python
# Before
genai.configure(api_key="your-google-key")

# After
ck.configure(api_key='dak_your_costkatana_key_here')
```

3. **Update Model Creation**
```python
# Before
model = genai.GenerativeModel('gemini-2.0-flash')

# After
model = ck.GenerativeModel('gemini-2.0-flash')
```

4. **Add Cost Tracking**
```python
# Before - No cost information
print(response.text)

# After - Full cost and usage information
print(response.text)
print(f"Cost: ${response.usage_metadata.cost:.4f}")
print(f"Tokens: {response.usage_metadata.total_tokens}")
print(f"Latency: {response.usage_metadata.latency:.2f}s")
```

## 🔄 Migration from AWS Bedrock

### Before (AWS Bedrock)
```python
# requirements.txt
boto3>=1.28.0

# Your code
import boto3
import json

# Initialize Bedrock client
bedrock = boto3.client(
    service_name='bedrock-runtime',
    region_name='us-east-1',
    aws_access_key_id='your-access-key',
    aws_secret_access_key='your-secret-key'
)

# Prepare request
body = json.dumps({
    "prompt": "Human: Hello, world!\n\nAssistant:",
    "max_tokens_to_sample": 1000,
    "temperature": 0.7,
    "top_p": 0.9
})

# Make request
response = bedrock.invoke_model(
    modelId='anthropic.claude-3-sonnet-20240229-v1:0',
    body=body,
    contentType='application/json'
)

# Parse response
result = json.loads(response['body'].read())
print(result['completion'])
# Manual cost calculation required
```

### After (CostKatana)
```python
# requirements.txt
cost-katana>=2.0.0

# Your code
import cost_katana as ck

# Simple configuration
ck.configure(api_key='dak_your_costkatana_key_here')

# Clean, simple API
model = ck.GenerativeModel('claude-3-sonnet')
response = model.generate_content(
    "Hello, world!",
    temperature=0.7,
    max_output_tokens=1000
)

print(response.text)
print(f"Cost: ${response.usage_metadata.cost:.4f}")
```

## 🚀 Advanced Migration Patterns

### Chat Sessions Migration

**Before (Multiple SDKs):**
```python
# OpenAI Chat
openai_response = openai.ChatCompletion.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello"}
    ]
)

# Anthropic Chat
anthropic_response = await anthropic.messages.create({
  model: 'claude-3-sonnet-20240229-v1:0',
  messages: [
    {"role": "user", "content": "Hello"}
  ]
})
```

**After (CostKatana):**
```python
# Unified chat interface for all providers
model = ck.GenerativeModel('gpt-4')  # or 'claude-3-sonnet'
chat = model.start_chat()

response1 = chat.send_message("Hello")
print("AI:", response1.text)

response2 = chat.send_message("Can you help me with Python?")
print("AI:", response2.text)

total_cost = sum(msg.get('metadata', {}).get('cost', 0) for msg in chat.history)
print(f"Total cost: ${total_cost:.4f}")
```

### Batch Processing Migration

**Before (Manual Implementation):**
```python
# Manual batch processing with multiple API calls
def batch_process_prompts(prompts):
    results = []
    for prompt in prompts:
        try:
            response = openai.ChatCompletion.create(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}]
            )
            results.append({
                'prompt': prompt,
                'response': response.choices[0].message.content,
                'cost': response.usage.total_tokens * 0.03 / 1000
            })
        except Exception as e:
            results.append({
                'prompt': prompt,
                'error': str(e)
            })
    return results
```

**After (CostKatana):**
```python
# Built-in batch processing with Cortex optimization
def batch_process_with_costkatana(prompts):
    model = ck.GenerativeModel('gpt-4')

    # Enable Cortex for massive cost savings
    results = model.bulk_generate_content(
        prompts,
        cortex={
            'enabled': True,
            'mode': 'answer_generation',
            'batch_processing': True
        }
    )

    return [
        {
            'prompt': prompt,
            'response': result.text,
            'cost': result.usage_metadata.cost,
            'savings': result.cortex_metadata.cost_savings if hasattr(result, 'cortex_metadata') else 0
        }
        for prompt, result in zip(prompts, results)
    ]
```

### Error Handling Migration

**Before (Basic Error Handling):**
```python
# Basic error handling
try:
    response = openai.ChatCompletion.create(...)
except openai.error.RateLimitError:
    print("Rate limited, try again later")
except openai.error.AuthenticationError:
    print("Invalid API key")
except Exception as e:
    print(f"Unexpected error: {e}")
```

**After (Advanced Error Handling):**
```python
# Comprehensive error handling with CostKatana
from cost_katana.exceptions import (
    RateLimitError, AuthenticationError, ModelNotAvailableError,
    CostLimitExceededError
)

async def robust_ai_request(prompt, max_retries=3):
    for attempt in range(max_retries):
        try:
            model = ck.GenerativeModel('gpt-4')
            response = await model.generate_content(prompt)
            return response

        except RateLimitError:
            wait_time = min(2 ** attempt, 30)
            print(f"Rate limited. Waiting {wait_time}s...")
            await asyncio.sleep(wait_time)

        except ModelNotAvailableError:
            print("Model unavailable, trying fallback...")
            model = ck.GenerativeModel('gpt-3.5-turbo')
            response = await model.generate_content(prompt)
            return response

        except CostLimitExceededError:
            print("Budget exceeded! Check your limits.")
            await send_budget_alert()
            break

        except AuthenticationError:
            print("Authentication failed. Check API key.")
            break

    raise Exception("All retry attempts failed")
```

## 📊 Adding Cost Tracking to Existing Code

### Wrapper Pattern for Gradual Migration

```python
# Create a wrapper to add CostKatana features to existing code
class CostKatanaWrapper:
    def __init__(self, api_key: str):
        ck.configure(api_key=api_key)
        self.model = ck.GenerativeModel('gpt-4')

    def chat_completion(self, messages, **kwargs):
        """Drop-in replacement for OpenAI chat completion."""
        # Convert OpenAI format to CostKatana
        prompt = self._convert_messages_to_prompt(messages)

        response = self.model.generate_content(prompt, **kwargs)

        # Convert back to OpenAI format for compatibility
        return {
            'choices': [{
                'message': {
                    'content': response.text,
                    'role': 'assistant'
                }
            }],
            'usage': {
                'total_tokens': response.usage_metadata.total_tokens,
                'cost': response.usage_metadata.cost
            }
        }

    def _convert_messages_to_prompt(self, messages):
        """Convert OpenAI message format to simple prompt."""
        prompt_parts = []
        for msg in messages:
            role = msg.get('role', 'user')
            content = msg.get('content', '')
            if role == 'system':
                prompt_parts.insert(0, f"System: {content}")
            elif role == 'user':
                prompt_parts.append(f"Human: {content}")
            elif role == 'assistant':
                prompt_parts.append(f"Assistant: {content}")

        return "\n\n".join(prompt_parts)

# Usage - Drop-in replacement
wrapper = CostKatanaWrapper(api_key='dak_your_key_here')

# Replace OpenAI calls
response = wrapper.chat_completion([
    {"role": "user", "content": "Hello, world!"}
])

print(response['choices'][0]['message']['content'])
print(f"Cost: ${response['usage']['cost']:.4f}")
```

## 🚨 Common Migration Pitfalls & Solutions

### 1. API Key Format Issues
**Problem**: Using old API key format
**Solution**: Ensure your key starts with `dak_`

```python
# ❌ Wrong format
api_key = "sk-your-old-key"

# ✅ Correct format
api_key = "dak_your_costkatana_key"
```

### 2. Model Name Differences
**Problem**: Model names may differ slightly between providers

**OpenAI Models in CostKatana:**
- `gpt-4` → `gpt-4`
- `gpt-4-turbo-preview` → `gpt-4-turbo-preview`
- `gpt-3.5-turbo` → `gpt-3.5-turbo`

**Anthropic Models in CostKatana:**
- `claude-3-sonnet-20240229-v1:0` → `claude-3-sonnet`
- `claude-3-haiku-20240307-v1:0` → `claude-3-haiku`

**Google Models in CostKatana:**
- `gemini-2.0-flash-exp` → `gemini-2.0-flash`
- `gemini-pro` → `gemini-pro`

### 3. Response Format Changes
**Problem**: Response structure may be different

```python
# Before (OpenAI)
text = response.choices[0].message.content
tokens = response.usage.total_tokens

# After (CostKatana)
text = response.text
tokens = response.usage_metadata.total_tokens
cost = response.usage_metadata.cost  # Bonus: automatic cost calculation
```

### 4. Async/Await Patterns
**Problem**: Some SDKs use different async patterns

```javascript
// Before (Anthropic SDK)
const response = await anthropic.messages.create({...});

// After (CostKatana)
const response = await tracker.generateContent('prompt', {...});
```

## 📈 Performance Optimization After Migration

### Enable Cortex for Cost Savings

```python
# Add Cortex to all requests after migration
response = model.generate_content(
    "your query",
    cortex={
        'enabled': True,
        'mode': 'answer_generation'  # 70-95% token reduction
    }
)
```

### Implement Caching

```python
# Add response caching to reduce API calls
cache = {}

def get_cached_response(prompt: str):
    if prompt in cache:
        return cache[prompt]

    response = model.generate_content(prompt)
    cache[prompt] = response
    return response
```

### Set Up Budget Monitoring

```python
# Monitor costs after migration
ck.configure(
    api_key='dak_your_key_here',
    cost_limit_per_day=50.0  # Set daily limits
)

# Enable budget alerts
# The SDK will automatically handle budget exceeded errors
```

## ✅ Migration Checklist

### Pre-Migration
- [ ] **Assess current usage**: Review current API calls and costs
- [ ] **Choose CostKatana package**: CLI, Core, or Python SDK
- [ ] **Get CostKatana API key**: Sign up at costkatana.com
- [ ] **Plan migration scope**: Start with simple calls, add features gradually

### During Migration
- [ ] **Install CostKatana package**
- [ ] **Replace API key configuration**
- [ ] **Update import statements**
- [ ] **Replace direct API calls**
- [ ] **Update response handling**
- [ ] **Add error handling and retry logic**

### Post-Migration
- [ ] **Test basic functionality**
- [ ] **Enable Cortex optimization**
- [ ] **Set up cost monitoring**
- [ ] **Configure budget limits**
- [ ] **Update team documentation**
- [ ] **Monitor costs and performance**

### Advanced Features to Add
- [ ] **Chat sessions** for conversational AI
- [ ] **Batch processing** for multiple requests
- [ ] **Caching** for frequently used prompts
- [ ] **Analytics integration** for usage tracking
- [ ] **CI/CD integration** for automated optimization

## 🆘 Migration Support

### Common Migration Questions

**Q: Will my existing code break after migration?**
**A:** No, CostKatana is designed to be a drop-in replacement. Start with basic migrations and gradually add advanced features.

**Q: How much will I save after migration?**
**A:** Most users see 40-70% cost reduction immediately, and 70-95% with Cortex optimization enabled.

**Q: Can I migrate gradually?**
**A:** Yes! Use the wrapper pattern to add CostKatana features to existing code without breaking changes.

**Q: What if I need help with migration?**
**A:** Contact our support team or join our Discord community for migration assistance.

---

**Ready to migrate?** Start with the [Quick Start Guide](costkatana-integration-guide.md) and then follow this migration guide for your specific provider. 🚀

