# CostKatana Python SDK Integration Guide

Comprehensive guide for integrating the `cost-katana` Python package into your applications and workflows.

## 📦 Installation & Setup

### Basic Installation
```bash
# Install from PyPI
pip install cost-katana

# With optional dependencies for enhanced features
pip install cost-katana[full]

# Install specific version
pip install cost-katana==2.0.0
```

### Development Installation
```bash
# Install in development mode
git clone https://github.com/Hypothesize-Tech/cost-katana-python.git
cd cost-katana-python
pip install -e .

# Install with development dependencies
pip install -e ".[dev]"
```

### Verify Installation
```python
import cost_katana as ck

# Test basic functionality
try:
    print("CostKatana SDK version:", ck.__version__)
    print("Installation successful!")
except ImportError as e:
    print(f"Installation failed: {e}")
```

## 🚀 Quick Start Integration

### Basic Setup
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
ck.configure()  # Loads from environment if available
```

### Basic Usage
```python
import cost_katana as ck

# Configure SDK
ck.configure(api_key='dak_your_key_here')

# Create model instance
model = ck.GenerativeModel('nova-lite')

# Generate content with cost tracking
response = model.generate_content("Hello, world!")

print("Generated text:", response.text)
print(f"Cost: ${response.usage_metadata.cost:.4f}")
print(f"Tokens used: {response.usage_metadata.total_tokens}")
print(f"Latency: {response.usage_metadata.latency:.2f}s")
```

### Class-based Integration
```python
import cost_katana as ck
from typing import Optional

class CostKatanaManager:
    def __init__(self, api_key: str, default_model: str = 'nova-lite'):
        ck.configure(api_key=api_key, default_model=default_model)
        self.model = ck.GenerativeModel(default_model)

    def generate_response(self, prompt: str, model: Optional[str] = None) -> str:
        """Generate AI response with cost tracking."""
        if model:
            # Temporarily use different model
            temp_model = ck.GenerativeModel(model)
            response = temp_model.generate_content(prompt)
        else:
            response = self.model.generate_content(prompt)

        # Log usage for monitoring
        self._log_usage(response)
        return response.text

    def _log_usage(self, response) -> None:
        """Log usage metadata for monitoring."""
        metadata = response.usage_metadata
        print(f"Model: {metadata.model}")
        print(f"Cost: ${metadata.cost:.4f}")
        print(f"Tokens: {metadata.total_tokens}")
        print(f"Latency: {metadata.latency:.2f}s")

# Usage
manager = CostKatanaManager(api_key='dak_your_key_here')
result = manager.generate_response("Explain quantum computing in simple terms")
```

## 🧠 Cortex Meta-Language Integration

### Basic Cortex Usage
```python
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')

model = ck.GenerativeModel('claude-3-sonnet')
response = model.generate_content(
    "Write a complete Python web scraper with error handling",
    cortex={
        'enabled': True,
        'mode': 'answer_generation',  # Generate complete answers in LISP
        'encoding_model': 'claude-3-5-sonnet',
        'core_model': 'claude-opus-4-1',
        'decoding_model': 'claude-3-5-sonnet',
        'dynamic_instructions': True,  # AI-powered LISP instruction generation
        'analytics': True
    }
)

print("Generated Answer:", response.text)
print(f"Token Reduction: {response.cortex_metadata.token_reduction}%")
print(f"Cost Savings: ${response.cortex_metadata.cost_savings:.4f}")
print(f"Confidence Score: {response.cortex_metadata.confidence}%")
print(f"Semantic Integrity: {response.cortex_metadata.semantic_integrity}%")
```

### Advanced Cortex Features
```python
# Bulk optimization with Cortex
queries = [
    "Explain machine learning algorithms",
    "Write a React authentication component",
    "Create a database migration script"
]

results = model.bulk_generate_content(
    queries,
    cortex={
        'enabled': True,
        'mode': 'answer_generation',
        'batch_processing': True,
        'dynamic_instructions': True
    }
)

for i, result in enumerate(results):
    print(f"Query {i+1}: {result.cortex_metadata.token_reduction}% reduction")

# Context-aware processing
technical_response = model.generate_content(
    "Implement a distributed caching system",
    cortex={
        'enabled': True,
        'context': 'technical',
        'complexity': 'high',
        'include_examples': True,
        'code_generation': True
    }
)

# Compare Cortex vs traditional processing
comparison = model.compare_cortex(
    query="Write a REST API with authentication in Flask",
    max_tokens=2000
)

print("=== COMPARISON RESULTS ===")
print(f"Traditional: {comparison['traditional']['tokens_used']} tokens, ${comparison['traditional']['cost']:.4f}")
print(f"Cortex: {comparison['cortex']['tokens_used']} tokens, ${comparison['cortex']['cost']:.4f}")
print(f"Savings: {comparison['savings']['token_reduction']}% tokens, ${comparison['savings']['cost_savings']:.4f}")
```

## 🔧 Advanced Integration Patterns

### Chat Sessions
```python
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')

# Start a conversation
model = ck.GenerativeModel('claude-3-sonnet')
chat = model.start_chat()

# Send messages back and forth
response1 = chat.send_message("Hello! What's your name?")
print("AI:", response1.text)

response2 = chat.send_message("Can you help me write a Python function?")
print("AI:", response2.text)

# Get total conversation cost
total_cost = sum(msg.get('metadata', {}).get('cost', 0) for msg in chat.history)
print(f"Total conversation cost: ${total_cost:.4f}")

# Clear conversation history
chat.clear_history()

# Delete conversation entirely
chat.delete_conversation()
```

### Multi-Agent Processing
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
print(f"Optimizations applied: {response.usage_metadata.optimizations_applied}")
print(f"Risk level: {response.usage_metadata.risk_level}")
```

### Custom Generation Configuration
```python
from cost_katana import GenerativeModel, GenerationConfig

# Create custom configuration
config = GenerationConfig(
    temperature=0.3,
    max_output_tokens=1000,
    top_p=0.9
)

model = GenerativeModel('claude-3-sonnet', generation_config=config)
response = model.generate_content("Write a haiku about programming")
```

## 📊 Cost Tracking & Analytics

### Real-time Cost Monitoring
```python
import cost_katana as ck
import logging

class CostMonitor:
    def __init__(self, api_key: str):
        ck.configure(api_key=api_key)
        self.total_cost = 0.0
        self.request_count = 0
        self.model_usage = {}

        # Set up logging
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)

    def generate_with_monitoring(self, prompt: str, model: str = 'nova-lite'):
        """Generate content with comprehensive monitoring."""
        model_instance = ck.GenerativeModel(model)
        response = model_instance.generate_content(prompt)

        # Update metrics
        self.total_cost += response.usage_metadata.cost
        self.request_count += 1

        # Track model usage
        model_name = response.usage_metadata.model
        if model_name not in self.model_usage:
            self.model_usage[model_name] = {'cost': 0, 'requests': 0}
        self.model_usage[model_name]['cost'] += response.usage_metadata.cost
        self.model_usage[model_name]['requests'] += 1

        # Log usage
        self.logger.info(f"Request {self.request_count}: ${response.usage_metadata.cost:.4f} "
                        f"(Model: {model_name}, Tokens: {response.usage_metadata.total_tokens})")

        return response

    def get_summary(self):
        """Get usage summary."""
        avg_cost = self.total_cost / self.request_count if self.request_count > 0 else 0
        return {
            'total_cost': round(self.total_cost, 4),
            'total_requests': self.request_count,
            'average_cost': round(avg_cost, 4),
            'model_breakdown': self.model_usage
        }

# Usage
monitor = CostMonitor(api_key='dak_your_key_here')

# Make some requests
monitor.generate_with_monitoring("Explain quantum computing")
monitor.generate_with_monitoring("Write a Python function", model='claude-3-sonnet')

# Get summary
summary = monitor.get_summary()
print(f"Total cost: ${summary['total_cost']}")
print(f"Average cost per request: ${summary['average_cost']}")
print("Model breakdown:", summary['model_breakdown'])
```

### Integration with Analytics Services
```python
import cost_katana as ck
import json
from datetime import datetime

def track_usage_to_file(response, prompt: str, request_id: str):
    """Track usage data to a JSON file for analysis."""

    usage_data = {
        'request_id': request_id,
        'timestamp': datetime.now().isoformat(),
        'prompt_length': len(prompt),
        'response_length': len(response.text),
        'model': response.usage_metadata.model,
        'cost': response.usage_metadata.cost,
        'tokens': response.usage_metadata.total_tokens,
        'latency': response.usage_metadata.latency,
        'cache_hit': response.usage_metadata.cache_hit,
        'risk_level': response.usage_metadata.risk_level
    }

    # Append to usage log file
    try:
        with open('usage_log.jsonl', 'a') as f:
            f.write(json.dumps(usage_data) + '\n')
    except Exception as e:
        print(f"Failed to log usage: {e}")

def send_to_external_analytics(response, prompt: str):
    """Send usage data to external analytics service."""
    # Example: Send to Datadog, CloudWatch, or custom analytics
    import requests

    analytics_payload = {
        'metric': 'ai_request_cost',
        'value': response.usage_metadata.cost,
        'tags': [
            f'model:{response.usage_metadata.model}',
            f'tokens:{response.usage_metadata.total_tokens}',
            f'cache_hit:{response.usage_metadata.cache_hit}'
        ]
    }

    try:
        # Replace with your analytics endpoint
        # response = requests.post('https://your-analytics-endpoint.com/metrics', json=analytics_payload)
        print(f"Would send to analytics: {analytics_payload}")
    except Exception as e:
        print(f"Failed to send to analytics: {e}")
```

## 🔄 Provider Integration Examples

### OpenAI Integration
```python
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')

# Seamless migration from OpenAI
def migrate_from_openai():
    # Before: Direct OpenAI SDK
    # import openai
    # openai.api_key = "your-openai-key"
    # response = openai.ChatCompletion.create(model="gpt-4", messages=[...])

    # After: CostKatana with OpenAI models
    model = ck.GenerativeModel('gpt-4')
    response = model.generate_content("Your prompt here")

    return response.text

# Usage with different OpenAI models
models = ['gpt-4', 'gpt-4-turbo-preview', 'gpt-3.5-turbo']
for model_name in models:
    model = ck.GenerativeModel(model_name)
    response = model.generate_content("Hello!")
    print(f"{model_name}: ${response.usage_metadata.cost:.4f}")
```

### Anthropic Integration
```python
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')

# Anthropic Claude integration
model = ck.GenerativeModel('claude-3-sonnet')
response = model.generate_content(
    "Explain quantum computing in simple terms",
    temperature=0.5,
    system_prompt="You are a helpful teacher explaining complex topics simply."
)

print(f"Claude response: {response.text}")
print(f"Cost: ${response.usage_metadata.cost:.4f}")

# Compare different Claude models
claude_models = ['claude-3-haiku', 'claude-3-sonnet', 'claude-3-opus']
for model_name in claude_models:
    model = ck.GenerativeModel(model_name)
    response = model.generate_content("Brief explanation of machine learning")
    print(f"{model_name}: ${response.usage_metadata.cost:.4f}")
```

### Google Gemini Integration
```python
import cost_katana as ck

ck.configure(api_key='dak_your_key_here')

# Google Gemini integration
model = ck.GenerativeModel('gemini-2.0-flash')
response = model.generate_content(
    "Write a comprehensive business plan",
    generation_config={
        'temperature': 0.8,
        'max_output_tokens': 2000,
        'top_k': 40,
        'top_p': 0.8
    }
)

print(f"Gemini response length: {len(response.text)} characters")
print(f"Cost: ${response.usage_metadata.cost:.4f}")
```

## 🚨 Error Handling & Retry Logic

### Comprehensive Error Handling
```python
import cost_katana as ck
from cost_katana.exceptions import (
    CostLimitExceededError,
    ModelNotAvailableError,
    RateLimitError,
    AuthenticationError
)

async def robust_ai_request(prompt: str, max_retries: int = 3):
    """Make AI requests with comprehensive error handling."""
    for attempt in range(max_retries):
        try:
            model = ck.GenerativeModel('nova-lite')
            response = model.generate_content(prompt)

            return response

        except CostLimitExceededError:
            print("❌ Budget exceeded! Check your limits in the dashboard.")
            await send_budget_alert()
            break

        except ModelNotAvailableError as e:
            print(f"⚠️  Model unavailable: {e}")
            if attempt < max_retries - 1:
                print("🔄 Trying fallback model...")
                try:
                    model = ck.GenerativeModel('claude-3-haiku')
                    return model.generate_content(prompt)
                except Exception as fallback_error:
                    print(f"❌ Fallback also failed: {fallback_error}")
            break

        except RateLimitError:
            wait_time = min(2 ** attempt, 30)  # Exponential backoff, max 30s
            print(f"⏳ Rate limited. Waiting {wait_time}s...")
            await asyncio.sleep(wait_time)
            continue

        except AuthenticationError:
            print("🔐 Authentication failed. Check your API key.")
            break

        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            if attempt == max_retries - 1:
                raise
            continue

    raise Exception(f"All {max_retries} attempts failed")

# Usage
import asyncio

async def main():
    response = await robust_ai_request("Explain quantum computing")
    print(f"Success: {response.text[:100]}...")

asyncio.run(main())
```

### Custom Exception Handling
```python
import cost_katana as ck
from typing import Dict, Any

class AIServiceError(Exception):
    """Custom exception for AI service errors."""

    def __init__(self, message: str, error_code: str, retryable: bool = False, metadata: Dict[str, Any] = None):
        super().__init__(message)
        self.error_code = error_code
        self.retryable = retryable
        self.metadata = metadata or {}

def handle_ai_errors(func):
    """Decorator for handling AI service errors."""
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except ck.CostLimitExceededError as e:
            raise AIServiceError(
                "Budget limit exceeded. Please check your account.",
                "BUDGET_EXCEEDED",
                retryable=False,
                metadata={'current_cost': e.current_cost, 'limit': e.limit}
            )
        except ck.ModelNotAvailableError as e:
            raise AIServiceError(
                f"Model {e.model} is currently unavailable.",
                "MODEL_UNAVAILABLE",
                retryable=True,
                metadata={'model': e.model, 'alternatives': e.alternatives}
            )
        except Exception as e:
            raise AIServiceError(
                f"Unexpected error: {str(e)}",
                "UNEXPECTED_ERROR",
                retryable=True
            )
    return wrapper

@handle_ai_errors
async def generate_content_with_error_handling(prompt: str):
    """Generate content with enhanced error handling."""
    model = ck.GenerativeModel('nova-lite')
    return model.generate_content(prompt)
```

## 🔒 Security & Best Practices

### Secure API Key Management
```python
import os
import cost_katana as ck

# Method 1: Environment variables (recommended)
api_key = os.getenv('API_KEY')
if not api_key or not api_key.startswith('dak_'):
    raise ValueError("Invalid API key. Must start with 'dak_'")

ck.configure(api_key=api_key)

# Method 2: Configuration file with restricted permissions
import json

def load_config(config_path: str = 'config.json') -> dict:
    """Load configuration from file with validation."""
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)

        # Validate required fields
        required_fields = ['api_key']
        for field in required_fields:
            if field not in config:
                raise ValueError(f"Missing required field: {field}")

        # Validate API key format
        if not config['api_key'].startswith('dak_'):
            raise ValueError("Invalid API key format")

        return config

    except FileNotFoundError:
        raise FileNotFoundError(f"Configuration file not found: {config_path}")
    except json.JSONDecodeError:
        raise ValueError(f"Invalid JSON in configuration file: {config_path}")

# Load and use configuration
config = load_config()
ck.configure(**config)
```

### Request Validation and Sanitization
```python
import re
import cost_katana as ck

def validate_and_sanitize_prompt(prompt: str) -> str:
    """Validate and sanitize user prompts."""

    if not prompt or not isinstance(prompt, str):
        raise ValueError("Prompt must be a non-empty string")

    # Length validation
    if len(prompt) > 100000:  # Reasonable limit
        raise ValueError("Prompt too long. Maximum 100,000 characters allowed.")

    if len(prompt.strip()) == 0:
        raise ValueError("Prompt cannot be empty or only whitespace")

    # Basic sanitization (remove potentially harmful content)
    # Remove script tags
    sanitized = re.sub(r'<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>', '', prompt, flags=re.IGNORECASE)

    # Remove other potentially dangerous patterns
    sanitized = re.sub(r'javascript:', '', sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r'on\w+\s*=', '', sanitized, flags=re.IGNORECASE)

    return sanitized.strip()

def validate_model_name(model_name: str) -> str:
    """Validate model name against allowed models."""
    allowed_models = [
        'nova-micro', 'nova-lite', 'nova-pro',
        'claude-3-haiku', 'claude-3-sonnet', 'claude-3-opus',
        'gpt-4', 'gpt-4-turbo-preview', 'gpt-3.5-turbo',
        'gemini-2.0-flash', 'gemini-pro'
    ]

    if model_name not in allowed_models:
        raise ValueError(f"Invalid model: {model_name}. Allowed: {allowed_models}")

    return model_name

# Usage in API endpoint
@app.route('/generate', methods=['POST'])
def generate_endpoint():
    try:
        data = request.get_json()

        # Validate inputs
        prompt = validate_and_sanitize_prompt(data.get('prompt', ''))
        model = validate_model_name(data.get('model', 'nova-lite'))

        # Generate response
        model_instance = ck.GenerativeModel(model)
        response = model_instance.generate_content(prompt)

        return jsonify({
            'text': response.text,
            'cost': response.usage_metadata.cost,
            'tokens': response.usage_metadata.total_tokens,
            'model': response.usage_metadata.model
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500
```

## 🚀 Production Deployment

### Docker Integration
```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user
RUN useradd --create-home --shell /bin/bash app
USER app

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import cost_katana as ck; ck.configure(api_key='test'); print('OK')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  cost-katana-app:
    build: .
    environment:
      - API_KEY=${API_KEY}
      - COST_KATANA_BASE_URL=${COST_KATANA_BASE_URL}
      - COST_KATANA_DEFAULT_MODEL=${COST_KATANA_DEFAULT_MODEL}
      - COST_KATANA_COST_LIMIT=${COST_KATANA_COST_LIMIT}
    env_file:
      - .env.local
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

### Environment Configuration
```bash
# .env file for different environments

# Development
API_KEY=dak_dev_key_here
COST_KATANA_DEFAULT_MODEL=nova-lite
COST_KATANA_COST_LIMIT=10.0

# Production
API_KEY=dak_prod_key_here
COST_KATANA_DEFAULT_MODEL=nova-pro
COST_KATANA_COST_LIMIT=100.0
```

## 📋 Integration Checklist

- [ ] Install `cost-katana` package
- [ ] Set up secure API key management (environment variables recommended)
- [ ] Configure SDK with `ck.configure()`
- [ ] Test basic functionality with simple prompts
- [ ] Implement comprehensive error handling with retry logic
- [ ] Add request validation and sanitization
- [ ] Set up cost monitoring and alerting
- [ ] Enable Cortex optimization for production workloads
- [ ] Implement logging for debugging and monitoring
- [ ] Test migration from existing provider SDKs
- [ ] Set up health checks for production deployment
- [ ] Configure Docker containerization for production

## 🆘 Troubleshooting Guide

### Common Issues & Solutions

#### 1. Import Errors
**Problem**: `ModuleNotFoundError: No module named 'cost_katana'`
**Solutions**:
- Verify installation: `pip list | grep cost-katana`
- Check Python version compatibility (>= 3.8)
- Try reinstalling: `pip uninstall cost-katana && pip install cost-katana`

#### 2. Authentication Failures
**Problem**: `AuthenticationError` or `Invalid API key`
**Solutions**:
- Verify API key format (must start with `dak_`)
- Check key validity in CostKatana dashboard
- Ensure sufficient credits remaining
- Test with minimal prompt first

#### 3. High Memory Usage
**Problem**: Application using excessive memory
**Solutions**:
- Use appropriate models for task complexity
- Implement response size limits
- Monitor and limit concurrent requests
- Use `nova-micro` for simple tasks

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
- Enable Cortex optimization (`cortex={'enabled': True}`)
- Set cost limits and budget alerts
- Monitor usage patterns regularly
- Use appropriate models for task complexity

---

**Need help with Python SDK integration?** Visit [docs.costkatana.com](https://docs.costkatana.com) or join our [Discord community](https://discord.gg/costkatana) 🚀

