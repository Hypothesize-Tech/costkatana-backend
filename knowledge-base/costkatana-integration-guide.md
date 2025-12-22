# CostKatana Package Integration Guide

This comprehensive guide covers integration of all CostKatana packages into your applications. Whether you're using the CLI, JavaScript/TypeScript core library, or Python SDK, this guide will help you get started quickly and resolve common integration issues.

## 📦 Package Overview

### 🖥️ CLI Package (`cost-katana-cli`)
- **NPM Package**: `cost-katana-cli` (available at https://www.npmjs.com/package/cost-katana-cli)
- **Purpose**: Command-line interface for AI cost optimization
- **Best For**: Development workflows, batch processing, interactive sessions
- **Key Features**: Cortex optimization, chat sessions, cost analysis, bulk operations

### 🔧 Core Package (`cost-katana`)
- **NPM Package**: `cost-katana` (available at https://www.npmjs.com/package/cost-katana)
- **Purpose**: Core library for AI cost tracking and optimization
- **Best For**: JavaScript/TypeScript applications, web integrations, server-side processing
- **Key Features**: Provider abstraction, cost tracking, intelligent routing, failover

### 🐍 Python SDK (`cost-katana`)
- **PyPI Package**: `cost-katana` (available at https://pypi.org/project/cost-katana/)
- **Purpose**: Python SDK for AI cost optimization with Cortex meta-language
- **Best For**: Python applications, data science workflows, ML pipelines
- **Key Features**: Cortex optimization, SAST processing, multi-provider support

## 🚀 Quick Start Integration

### CLI Package Quick Start
```bash
# Install globally
npm install -g cost-katana-cli

# Initialize configuration
cost-katana init

# Test setup
cost-katana test

# Start interactive chat
cost-katana chat --model nova-lite
```

### Core Package Quick Start (JavaScript/TypeScript)
```javascript
// npm install cost-katana
const { CostTracker } = require('cost-katana');

// Initialize with API key
const tracker = new CostTracker({
  apiKey: 'dak_your_key_here',
  defaultModel: 'nova-lite'
});

// Track API usage
const response = await tracker.generateContent('Hello, world!');
console.log(`Cost: $${response.usage_metadata.cost}`);
```

### Python SDK Quick Start
```python
# pip install cost-katana
import cost_katana as ck

# Configure with API key
ck.configure(api_key='dak_your_key_here')

# Use any AI model
model = ck.GenerativeModel('nova-lite')
response = model.generate_content("Hello, world!")
print(f"Cost: ${response.usage_metadata.cost:.4f}")
```

## 🛠️ Installation & Setup

### CLI Package Installation
```bash
# Global installation (recommended)
npm install -g cost-katana-cli

# Local installation for development
npm install cost-katana-cli --save-dev
```

### Core Package Installation
```bash
# For Node.js projects
npm install cost-katana

# For TypeScript projects (includes type definitions)
npm install --save-dev @types/cost-katana
```

### Python SDK Installation
```bash
# Basic installation
pip install cost-katana

# With optional dependencies for enhanced features
pip install cost-katana[full]

# Development installation
pip install -e .
```

## ⚙️ Configuration Management

### Environment Variables (All Packages)
```bash
# Common environment variables
export API_KEY=dak_your_key_here
export COST_KATANA_BASE_URL=https://api.costkatana.com
export COST_KATANA_DEFAULT_MODEL=nova-lite
export COST_KATANA_COST_LIMIT=50.0
```

### CLI Configuration File
```json
// ~/.cost-katana/config.json
{
  "apiKey": "dak_your_key_here",
  "baseUrl": "https://api.costkatana.com",
  "defaultModel": "nova-lite",
  "defaultTemperature": 0.7,
  "costLimitPerDay": 50.0,
  "enableAnalytics": true,
  "enableOptimization": true
}
```

### Core Package Configuration
```javascript
const { CostTracker } = require('cost-katana');

const tracker = new CostTracker({
  apiKey: COST_KATANA_API_KEY,
  baseUrl: process.env.COST_KATANA_BASE_URL,
  defaultModel: process.env.COST_KATANA_DEFAULT_MODEL || 'nova-lite',
  defaultTemperature: 0.7,
  costLimitPerDay: 50.0,
  enableAnalytics: true
});
```

### Python SDK Configuration
```python
import cost_katana as ck

# Method 1: Direct configuration
ck.configure(
    api_key='dak_your_key_here',
    default_model='nova-lite',
    cost_limit_per_day=50.0
)

# Method 2: Configuration file
ck.configure(config_file='config.json')

# Method 3: Environment variables (automatic)
ck.configure()  # Loads from environment
```

## 🧠 Cortex Meta-Language Integration

### CLI Cortex Integration
```bash
# Enable Cortex for massive token savings (40-75% reduction)
cost-katana optimize --prompt "Write a complete REST API" --cortex

# Advanced Cortex configuration
cost-katana optimize \
  --prompt "Create a React component" \
  --cortex \
  --cortex-mode answer_generation \
  --encoding-model claude-3-5-sonnet \
  --core-model claude-opus-4-1 \
  --dynamic-instructions \
  --verbose
```

### Core Package Cortex Integration
```javascript
const { CostTracker } = require('cost-katana');

const tracker = new CostTracker({
  apiKey: 'dak_your_key_here',
  enableCortex: true
});

const response = await tracker.generateContent(
  'Write a Python web scraper',
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
```

### Python SDK Cortex Integration
```python
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')

model = ck.GenerativeModel('claude-3-sonnet')
response = model.generate_content(
    "Write a complete Python web scraper with error handling",
    cortex={
        'enabled': True,
        'mode': 'answer_generation',
        'encoding_model': 'claude-3-5-sonnet',
        'core_model': 'claude-opus-4-1',
        'decoding_model': 'claude-3-5-sonnet',
        'dynamic_instructions': True,
        'analytics': True
    }
)

print(f"Token Reduction: {response.cortex_metadata.token_reduction}%")
print(f"Cost Savings: ${response.cortex_metadata.cost_savings:.4f}")
```

## 🔧 Advanced Integration Patterns

### Multi-Agent Processing (Python SDK)
```python
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')

model = ck.GenerativeModel('gemini-2.0-flash')
response = model.generate_content(
    "Analyze the economic impact of AI on job markets",
    use_multi_agent=True,
    chat_mode='balanced'
)

print(f"Agent path: {response.usage_metadata.agent_path}")
print(f"Optimizations: {response.usage_metadata.optimizations_applied}")
```

### Batch Processing (CLI)
```bash
# Bulk optimization from CSV
cost-katana bulk-optimize --file prompts.csv

# Priority-based optimization
cost-katana bulk-optimize priority --file prompts.csv --priority high

# Model-specific optimization
cost-katana bulk-optimize models --file prompts.csv --models "gpt-4,claude-3-sonnet"
```

### Chat Sessions (All Packages)
```javascript
// Core Package - Chat Session
const chat = tracker.startChat({ model: 'claude-3-sonnet' });
const response1 = await chat.sendMessage("Hello! What's your name?");
const response2 = await chat.sendMessage("Can you help me write a function?");
console.log(`Total cost: $${chat.getTotalCost()}`);
```

```python
# Python SDK - Chat Session
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')

model = ck.GenerativeModel('claude-3-sonnet')
chat = model.start_chat()

response1 = chat.send_message("Hello! What's your name?")
print("AI:", response1.text)

response2 = chat.send_message("Can you help me write a Python function?")
print("AI:", response2.text)

total_cost = sum(msg.get('metadata', {}).get('cost', 0) for msg in chat.history)
print(f"Total conversation cost: ${total_cost:.4f}")
```

## 📊 Cost Tracking & Analytics

### Real-time Cost Monitoring
```javascript
// Core Package - Cost Tracking
const response = await tracker.generateContent('Your prompt');
const metadata = response.usage_metadata;

console.log(`Model: ${metadata.model}`);
console.log(`Cost: $${metadata.cost}`);
console.log(`Tokens: ${metadata.total_tokens}`);
console.log(`Latency: ${metadata.latency}s`);
console.log(`Risk Level: ${metadata.risk_level}`);
```

```python
# Python SDK - Usage Analytics
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')

model = ck.GenerativeModel('claude-3-sonnet')
response = model.generate_content("Explain machine learning")

metadata = response.usage_metadata
print(f"Model used: {metadata.model}")
print(f"Cost: ${metadata.cost:.4f}")
print(f"Latency: {metadata.latency:.2f}s")
print(f"Tokens: {metadata.total_tokens}")
print(f"Cache hit: {metadata.cache_hit}")
```

### Budget Management (CLI)
```bash
# Set budget with notifications
cost-katana set-budget --project my-project --tokens 500000 --notify webhook --webhook-url https://hooks.slack.com/test

# Check budget status
cost-katana set-budget status --project my-project

# Configure alerts
cost-katana set-budget alerts --project my-project --enable-slack --enable-email
```

## 🚨 Error Handling & Troubleshooting

### Common Integration Issues

#### 1. API Key Authentication Errors
**Problem**: `Authentication failed` or `Invalid API key`
**Solutions**:
- Verify your API key starts with `dak_`
- Check that your key is active and has sufficient credits
- Ensure you're using the correct environment (production vs development)

#### 2. Model Not Available Errors
**Problem**: `Model not available` or `Service unavailable`
**Solutions**:
- Check model name spelling (case-sensitive)
- Verify the model is supported by your current plan
- Try alternative models if the specific model is temporarily unavailable

#### 3. Rate Limiting Issues
**Problem**: `Rate limit exceeded` or `Too many requests`
**Solutions**:
- Implement exponential backoff in your retry logic
- Add delays between requests
- Consider upgrading your plan for higher rate limits

#### 4. Cost Limit Exceeded
**Problem**: `Cost limit exceeded` or `Budget reached`
**Solutions**:
- Check your current usage in the dashboard
- Increase budget limits in configuration
- Implement cost monitoring in your application

### Debug Mode (All Packages)
```bash
# CLI Debug Mode
cost-katana optimize --prompt "test" --verbose --debug
```

```javascript
// Core Package Debug
const tracker = new CostTracker({
  apiKey: 'dak_your_key_here',
  debug: true,
  logLevel: 'debug'
});
```

```python
# Python SDK Debug
import logging

logging.basicConfig(level=logging.DEBUG)
ck.configure(api_key='dak_your_key_here', debug=True)
```

## 🔄 Migration from Direct Provider SDKs

### From OpenAI SDK
```python
# Before (OpenAI)
import openai

openai.api_key = "your-openai-key"
response = openai.ChatCompletion.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)

# After (Cost Katana)
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')
model = ck.GenerativeModel('gpt-4')
response = model.generate_content("Hello")
```

### From Anthropic SDK
```javascript
// Before (Anthropic)
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: 'your-anthropic-key',
});

const response = await anthropic.messages.create({
  model: 'claude-3-sonnet-20240229-v1:0',
  max_tokens: 1000,
  messages: [{ role: 'user', content: 'Hello' }],
});

// After (Cost Katana)
const { CostTracker } = require('cost-katana');

const tracker = new CostTracker({
  apiKey: 'dak_your_key_here'
});

const response = await tracker.generateContent('Hello', {
  model: 'claude-3-sonnet',
  maxTokens: 1000
});
```

### From Google Gemini SDK
```python
# Before (Google Gemini)
import google.generativeai as genai

genai.configure(api_key="your-google-key")
model = genai.GenerativeModel('gemini-2.0-flash')
response = model.generate_content("Hello")

# After (Cost Katana)
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')
model = ck.GenerativeModel('gemini-2.0-flash')
response = model.generate_content("Hello")
```

## 🎯 Best Practices

### 1. API Key Management
- Store API keys securely (environment variables, secret managers)
- Never commit API keys to version control
- Use different keys for development and production
- Regularly rotate your API keys

### 2. Error Handling
- Always implement proper error handling
- Use exponential backoff for retries
- Log errors for debugging but don't expose sensitive information
- Implement graceful degradation for non-critical features

### 3. Cost Optimization
- Use Cortex optimization for production workloads (40-75% savings)
- Choose appropriate models based on task complexity
- Implement caching for frequently used prompts
- Monitor usage patterns to identify optimization opportunities

### 4. Performance Optimization
- Use appropriate temperature values (0.1-0.3 for factual content, 0.7-0.9 for creative)
- Batch similar requests when possible
- Implement request queuing for high-volume scenarios
- Use streaming for long responses when available

## 📋 Integration Checklist

- [ ] Install appropriate CostKatana package(s)
- [ ] Set up API key securely
- [ ] Configure environment variables or config files
- [ ] Test basic functionality with simple prompts
- [ ] Implement error handling and retry logic
- [ ] Set up cost monitoring and budgets
- [ ] Enable Cortex optimization for production use
- [ ] Test migration from existing provider SDKs
- [ ] Implement logging for debugging
- [ ] Set up alerts for budget limits

## 🆘 Getting Help

### Support Channels
- **Documentation**: [docs.costkatana.com](https://docs.costkatana.com)
- **Discord Community**: [discord.gg/costkatana](https://discord.gg/D8nDArmKbY)
- **Email Support**: support@costkatana.com
- **GitHub Issues**: [github.com/cost-katana](https://github.com/cost-katana)

### Common Issues & Solutions
1. **"Module not found" errors**: Check installation and import paths
2. **Authentication failures**: Verify API key format and validity
3. **High costs**: Enable Cortex optimization and monitor usage
4. **Slow responses**: Check network connectivity and model availability
5. **Rate limiting**: Implement proper retry logic with delays

---

**Ready to optimize your AI integration?** Get started at [costkatana.com](https://costkatana.com) 🚀

