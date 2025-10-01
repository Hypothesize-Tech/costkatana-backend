# CostKatana CLI Integration Guide

Comprehensive guide for integrating and using the `ai-cost-optimizer-cli` package in your development workflow.

## 📦 Installation & Setup

### Global Installation (Recommended)
```bash
npm install -g ai-cost-optimizer-cli
```

### Local Installation (For Development)
```bash
npm install ai-cost-optimizer-cli --save-dev
```

### Verify Installation
```bash
cost-katana --version
cost-katana --help
```

## 🚀 Quick Start

### 1. Initialize Configuration
```bash
cost-katana init
```

This interactive setup will guide you through:
- **Project Name**: Identify your project for cost tracking
- **API Key**: Secure authentication to Cost Katana backend (`dak_` prefixed)
- **Default Model**: Choose your preferred AI model
- **Monthly Token Budget**: Set your usage limits

### 2. Test Configuration
```bash
cost-katana test
```

### 3. Basic Usage Examples

#### Interactive Chat Session
```bash
# Start a chat session with default model
cost-katana chat

# Chat with specific model
cost-katana chat --model nova-lite

# Chat with custom temperature
cost-katana chat --temperature 0.8

# Load conversation from file
cost-katana chat --file conversation.json

# Save conversation to file
cost-katana chat --output session.json
```

#### Single Prompt Optimization
```bash
# Basic optimization
cost-katana optimize --prompt "Write a Python function to calculate fibonacci numbers"

# With Cortex optimization (70-95% token reduction)
cost-katana optimize --prompt "Write a complete REST API" --cortex

# Specify model explicitly
cost-katana optimize --prompt "Explain quantum computing" --model claude-3-sonnet

# Save output to file
cost-katana optimize --prompt "Create a React component" --output component.jsx

# Verbose output for debugging
cost-katana optimize --prompt "Debug this code" --verbose
```

#### Cost Analysis
```bash
# Analyze last 30 days of usage
cost-katana analyze

# Analyze specific time period
cost-katana analyze --days 7

# Filter by model
cost-katana analyze --model gpt-4

# Export to CSV
cost-katana analyze --format csv --export usage.csv

# Verbose analysis
cost-katana analyze --verbose
```

## 🧠 Cortex Meta-Language Integration

### Basic Cortex Usage
```bash
# Enable Cortex for massive token savings
cost-katana optimize --prompt "Write a complete web application" --cortex

# Answer generation mode (complete responses in LISP format)
cost-katana optimize --prompt "Implement a database schema" --cortex --cortex-mode answer_generation

# Prompt optimization mode (optimize the prompt itself)
cost-katana optimize --prompt "Very long prompt here..." --cortex --cortex-mode prompt_optimization
```

### Advanced Cortex Configuration
```bash
# Custom model selection for Cortex pipeline
cost-katana optimize \
  --prompt "Create a comprehensive ML pipeline" \
  --cortex \
  --encoding-model claude-3-5-sonnet \
  --core-model claude-opus-4-1 \
  --decoding-model claude-3-5-sonnet \
  --dynamic-instructions \
  --verbose

# Batch processing with Cortex
cost-katana optimize \
  --file queries.txt \
  --cortex \
  --batch-processing \
  --dynamic-instructions \
  --output results.json

# Context-aware processing
cost-katana optimize \
  --prompt "Implement a financial trading algorithm" \
  --cortex \
  --context technical \
  --complexity high \
  --include-examples \
  --code-generation
```

### Cortex vs Traditional Comparison
```bash
# Compare Cortex vs traditional processing
cost-katana compare-cortex --prompt "Write a detailed research paper"

# Compare with specific constraints
cost-katana compare-cortex \
  --prompt "Complex analysis task" \
  --max-tokens 2000 \
  --target-cost 30
```

## 🔧 Configuration Management

### View Current Configuration
```bash
cost-katana config --list
cost-katana config --get apiKey
cost-katana config --get defaultModel
```

### Update Configuration
```bash
# Set specific values
cost-katana config --set apiKey=new_api_key_here
cost-katana config --set defaultModel=claude-3-sonnet
cost-katana config --set costLimitPerDay=100.0

# Set multiple values
cost-katana config --set apiKey=dak_new_key --set defaultModel=nova-pro
```

### Export/Import Configuration
```bash
# Export current configuration
cost-katana config --export config-backup.json

# Import configuration
cost-katana config --import production-config.json

# Reset to defaults
cost-katana config --reset
```

## 📊 Advanced Usage Patterns

### Bulk Operations
```bash
# Process multiple prompts from CSV
cost-katana bulk-optimize --file prompts.csv

# CSV Format:
# prompt_id,prompt_text,model,priority
# 1,"Explain quantum computing",claude-3-sonnet,high
# 2,"Write a Python function",gpt-4,medium

# Priority-based optimization
cost-katana bulk-optimize priority --file prompts.csv --priority high

# Model-specific optimization
cost-katana bulk-optimize models --file prompts.csv --models "gpt-4,claude-3-sonnet"
```

### Multi-step Workflows
```bash
# Create workflow interactively
cost-katana craft-workflow --interactive

# Use predefined template
cost-katana craft-workflow --template legal_analysis

# Evaluate workflow cost and performance
cost-katana craft-workflow --evaluate --workflow workflow.json

# Export workflow
cost-katana craft-workflow --export-json --export-yaml --workflow workflow.json
```

### Cost Simulation
```bash
# Simulate cost scenarios
cost-katana simulate-cost --prompt-id prompt-123 --what-if '{"model": "claude-3-haiku", "retry": 2}'

# Compare different models
cost-katana simulate-cost --compare-models --prompt-id prompt-123 --models "gpt-4,claude-3-sonnet,claude-3-haiku"

# Optimize retry strategies
cost-katana simulate-cost --optimize-retries --prompt-id prompt-123

# Batch simulation
cost-katana simulate-cost --batch --file scenarios.csv
```

### Intelligent Prompt Rewriting
```bash
# Rewrite with different styles
cost-katana rewrite-prompt --prompt "Explain quantum computing" --style concise

# Target specific audience
cost-katana rewrite-prompt --prompt "Technical explanation" --audience technical

# Compare rewrite styles
cost-katana rewrite-prompt --compare --prompt "Complex topic" --styles "short,concise,extractive"

# Batch rewriting
cost-katana rewrite-prompt --batch --file prompts.txt --style concise
```

## 💰 Budget Management

### Set Budget Limits
```bash
# Set token budget with webhook notifications
cost-katana set-budget \
  --project my-project \
  --tokens 500000 \
  --notify webhook \
  --webhook-url https://hooks.slack.com/your-webhook

# Set cost budget with Slack notifications
cost-katana set-budget \
  --project my-project \
  --cost 1000 \
  --notify slack \
  --slack-channel "#alerts"

# Set multiple notification types
cost-katana set-budget \
  --project my-project \
  --cost 500 \
  --notify webhook,email \
  --webhook-url https://your-webhook.com \
  --email-alerts
```

### Monitor Budget Usage
```bash
# Check current budget status
cost-katana set-budget --status --project my-project

# List all configured budgets
cost-katana set-budget --list

# Configure alert thresholds
cost-katana set-budget --alerts --project my-project --thresholds 80,95

# Test notifications
cost-katana set-budget --test --project my-project --type slack
```

## 🔍 Model Management

### List Available Models
```bash
# List all models
cost-katana list-models

# List models by provider
cost-katana list-models --provider openai
cost-katana list-models --provider anthropic
cost-katana list-models --provider google

# List with detailed information
cost-katana list-models --verbose

# Export model list
cost-katana list-models --format json --export models.json
cost-katana list-models --format csv --export models.csv
```

### Model Selection Guide
```bash
# Fast and cheap (for simple tasks)
cost-katana list-models --provider amazon --filter "nova-micro,nova-lite"

# Balanced performance (general use)
cost-katana list-models --filter "nova-lite,claude-3-sonnet,gpt-4"

# High performance (complex tasks)
cost-katana list-models --filter "nova-pro,claude-3-opus,gpt-4-turbo"
```

## 🛠️ Development & Testing

### Development Setup
```bash
# Clone repository
git clone <repository-url>
cd ai-cost-optimizer-cli

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

### Testing Commands
```bash
# Test all new commands
cost-katana craft-workflow --help
cost-katana simulate-cost --help
cost-katana bulk-optimize --help

# Test with sample data
echo "prompt_id,prompt_text,model
1,Explain quantum computing,claude-3-sonnet
2,Write a business plan,gpt-4" > test-prompts.csv

cost-katana bulk-optimize --file test-prompts.csv
cost-katana rewrite-prompt --prompt "Explain quantum computing" --style concise
```

## 🚨 Error Handling & Troubleshooting

### Common CLI Issues

#### 1. Command Not Found
**Problem**: `cost-katana: command not found`
**Solutions**:
- Ensure global installation: `npm install -g ai-cost-optimizer-cli`
- Check PATH environment variable
- Use `npx cost-katana` if installed locally

#### 2. Configuration Issues
**Problem**: `Configuration file not found` or `Invalid configuration`
**Solutions**:
- Run `cost-katana init` to create configuration
- Check file permissions on `~/.cost-katana/config.json`
- Verify API key format (must start with `dak_`)

#### 3. API Key Issues
**Problem**: `Authentication failed` or `Invalid API key`
**Solutions**:
- Verify API key in `cost-katana config --get apiKey`
- Check that key is active in dashboard
- Ensure sufficient credits remaining

#### 4. Model Availability
**Problem**: `Model not available` or `Service temporarily unavailable`
**Solutions**:
- Check model name spelling (case-sensitive)
- Try alternative models: `cost-katana list-models`
- Contact support if issue persists

#### 5. High Costs
**Problem**: Unexpected high costs or budget exceeded
**Solutions**:
- Enable Cortex optimization: `--cortex` flag
- Set cost limits: `cost-katana set-budget`
- Monitor usage: `cost-katana analyze`

### Debug Mode
```bash
# Enable debug mode for detailed logging
cost-katana optimize --prompt "test" --verbose --debug

# Test with minimal prompt to check configuration
cost-katana test --verbose

# Check API connectivity
cost-katana config --get baseUrl
curl -H "Authorization: Bearer $API_KEY" $BASE_URL/health
```

## 📋 CLI Integration Checklist

- [ ] Install CLI package globally
- [ ] Run `cost-katana init` to configure
- [ ] Test configuration with `cost-katana test`
- [ ] Set up budget limits with `cost-katana set-budget`
- [ ] Test basic commands (`chat`, `optimize`, `analyze`)
- [ ] Enable Cortex optimization for production use
- [ ] Configure notifications for budget alerts
- [ ] Set up automated cost monitoring
- [ ] Document CLI commands in team documentation

## 🔗 Integration Examples

### CI/CD Pipeline Integration
```bash
#!/bin/bash
# Example CI/CD script

# Install CLI
npm install -g ai-cost-optimizer-cli

# Configure for CI environment
cost-katana init --api-key $API_KEY --model nova-lite --force

# Test configuration
cost-katana test

# Run batch optimization
cost-katana bulk-optimize --file prompts.csv --cortex

# Check costs
cost-katana analyze --days 1 --format json
```

### Development Workflow Integration
```bash
#!/bin/bash
# Example development workflow

# Generate documentation
cost-katana optimize --prompt "Generate README for this project" --output README.md --cortex

# Code review assistance
cost-katana chat --model claude-3-sonnet --file code-review-session.json

# Test case generation
cost-katana optimize --prompt "Generate comprehensive test cases for user authentication" --cortex --output tests.py

# Performance analysis
cost-katana analyze --days 7 --verbose --export performance-report.csv
```

---

**Need help with CLI integration?** Visit [docs.costkatana.com](https://docs.costkatana.com) or join our [Discord community](https://discord.gg/costkatana) 🚀

