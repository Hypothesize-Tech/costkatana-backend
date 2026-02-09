# Prompt Caching Implementation Guide

## Overview

Cost Katana now implements **true prompt caching** (KV-pair caching) across all major AI providers. Unlike traditional output caching that stores complete responses, prompt caching caches the LLM's internal computation state (key-value pairs) during the prefill phase, providing significant performance and cost improvements for applications with repeated static content.

## What is Prompt Caching?

### Traditional Output Caching (What We Don't Do)
```
User Query → LLM Processing → Response → Cache Response
                                      ↓
Next Similar Query → Check Cache → Return Cached Response
```
- **Pros**: Simple implementation
- **Cons**: Only works for identical queries, misses semantic similarities, no performance improvement for LLM processing

### True Prompt Caching (What We Implement)
```
Static Content + Dynamic Query → LLM Prefill (KV Cache) → Generate Response
                                      ↓
Next Query with Same Static Content → Load Cached KV → Generate Response
```
- **Pros**: 30-70% cost reduction, faster responses, works for semantic variations
- **Cons**: More complex implementation, provider-specific approaches

## Supported Providers

### Anthropic Claude
- **Cache Type**: Explicit (cache_control breakpoints)
- **Models**: Claude 3.5+, Claude 4.0+
- **Min Tokens**: 1,024
- **Max Breakpoints**: 4
- **TTL**: 5 minutes
- **Pricing**: $0.30/1M cached tokens (90% discount)

### OpenAI GPT
- **Cache Type**: Automatic (prefix matching)
- **Models**: GPT-4o, GPT-4o-mini, o1, o1-mini
- **Min Tokens**: 1,024
- **TTL**: 5-10 minutes
- **Pricing**: 50% discount on cached tokens

### Google Gemini
- **Cache Type**: Explicit (context caching API)
- **Models**: Gemini 2.5 Pro, Gemini 2.5 Flash
- **Min Tokens**: 32,768
- **TTL**: Configurable (5 min to 24 hours)
- **Pricing**: $0.03-0.125/1M cached tokens + storage costs

## How It Works

### 1. Request Analysis
When a request comes in, Cost Katana:
1. Detects the provider and model
2. Extracts messages from the request
3. Analyzes prompt structure for cacheable content
4. Applies provider-specific caching optimizations

### 2. Structure Optimization
Messages are reordered to maximize cache hits:
```typescript
// BAD: Dynamic content first
[User Question] → [System Prompt] → [Document]

// GOOD: Static content first
[System Prompt] → [Document] → [User Question]
     ↑ Cached       ↑ Cached       ↑ Not Cached
```

### 3. Provider-Specific Implementation

#### Anthropic Claude
```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "System instructions...",
          "cache_control": {"type": "ephemeral"}
        },
        {
          "type": "text",
          "text": "Large document...",
          "cache_control": {"type": "ephemeral"}
        },
        {
          "type": "text",
          "text": "New question"
        }
      ]
    }
  ]
}
```

#### OpenAI GPT
```json
{
  "messages": [
    {"role": "system", "content": "..."}, // Automatically cached
    {"role": "user", "content": "Document..."},
    {"role": "user", "content": "Question"} // Not cached
  ]
}
```

#### Google Gemini
```json
// 1. Create cached content
POST /cachedContents
{
  "model": "models/gemini-2.5-pro",
  "contents": [...], // Static content
  "ttl": "300s"
}

// 2. Use cached content
POST /models/gemini-2.5-pro:generateContent
{
  "cached_content": "cachedContents/abc123",
  "contents": [...] // New query
}
```

## API Usage

### Automatic Enablement
Prompt caching is automatically enabled for supported providers:

```bash
# Enable prompt caching for all requests
curl -X POST https://api.costkatana.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "CostKatana-Prompt-Caching: true" \
  -d '{
    "model": "claude-sonnet-4-5",
    "messages": [...]
  }'
```

### Response Headers
Cache usage is reported in response headers:

```bash
# Cache hit/usage information
CostKatana-Prompt-Caching-Enabled: true
CostKatana-Prompt-Caching-Type: explicit
CostKatana-Prompt-Caching-Estimated-Savings: 0.0027
CostKatana-Prompt-Caching-Creation-Tokens: 10000
CostKatana-Prompt-Caching-Read-Tokens: 0
CostKatana-Prompt-Caching-Hit-Rate: 0.00

# Provider-specific headers
x-anthropic-cache-enabled: true
x-anthropic-cache-breakpoints: 2
x-anthropic-cache-creation-tokens: 10000
x-anthropic-cache-ttl: 300
```

## Cost Optimization Examples

### Example 1: Document Q&A Chatbot
```
Static Content: 50-page product manual (40K tokens)
Dynamic Content: User questions (100 tokens each)

Without Caching:
- Total tokens per query: 40,100
- Cost per query: $0.101 (at $2.50/1M tokens)

With Caching:
- Cached tokens: 40,000 (static content)
- New tokens: 100 (question)
- Cost per query: $0.0305 (70% savings)
- Cache creation cost: $0.012 (one-time)
```

### Example 2: Code Analysis Agent
```
Static Content: Large codebase (100K tokens)
Dynamic Content: Analysis requests (200 tokens each)

Without Caching:
- Total tokens per analysis: 100,200
- Cost per analysis: $0.251

With Caching:
- Cached tokens: 100,000
- New tokens: 200
- Cost per analysis: $0.0755 (70% savings)
```

## Best Practices

### 1. Prompt Structure
```typescript
// ✅ GOOD: Cache-friendly structure
const messages = [
  { role: 'system', content: 'You are a helpful assistant...' },
  { role: 'user', content: 'Here is a 50-page document: [large document]' },
  { role: 'user', content: 'Summarize the key points' }
];

// ❌ BAD: Cache-breaking structure
const messages = [
  { role: 'user', content: 'Summarize this: [large document]' },
  { role: 'system', content: 'You are a helpful assistant...' }
];
```

### 2. Content Types to Cache
- **System prompts**: Instructions, personality, rules
- **Documents**: Manuals, articles, codebases
- **Context**: User profiles, application state
- **Tools/APIs**: Function definitions, available actions

### 3. Content Types NOT to Cache
- **User questions**: Always dynamic
- **Conversation history**: Changes frequently
- **Timestamps**: Cause cache misses
- **Random elements**: API keys, session IDs

### 4. Minimum Token Thresholds
- **Anthropic/OpenAI**: 1,024 tokens minimum for caching
- **Google Gemini**: 32,768 tokens minimum
- **Benefits start at**: 2,000+ tokens of static content

## Monitoring & Analytics

### Cache Performance Metrics
```typescript
interface CacheMetrics {
  enabled: boolean;
  type: 'automatic' | 'explicit' | 'none';
  cacheCreationTokens: number;    // Tokens used to create cache
  cacheReadTokens: number;         // Tokens read from cache
  regularTokens: number;           // Tokens processed normally
  savingsFromCaching: number;      // Actual USD saved
  estimatedSavings: number;        // Estimated USD savings
  cacheHits: number;               // Number of cache hits
  cacheMisses: number;             // Number of cache misses
  hitRate: number;                 // Cache hit rate (0-1)
}
```

### Optimization Recommendations
Cost Katana automatically detects caching opportunities:

```json
{
  "type": "enable_prompt_caching",
  "description": "Enable prompt caching for anthropic - detected 65% repeated content patterns",
  "estimatedSavings": 45.50,
  "confidence": 0.85,
  "implementation": {
    "provider": "anthropic",
    "method": "Add cache_control breakpoints",
    "tokenThreshold": 1024,
    "structure": "Move system prompt before documents",
    "model": "claude-sonnet-4-5"
  }
}
```

## Troubleshooting

### Common Issues

#### 1. Cache Not Working
```bash
# Check if provider supports caching
curl -H "Authorization: Bearer YOUR_KEY" \
     https://api.costkatana.com/v1/models/claude-sonnet-4-5

# Response should include cache pricing information
{
  "cachePricing": {
    "supportsCaching": true,
    "cacheType": "explicit",
    "minTokens": 1024
  }
}
```

#### 2. Low Cache Hit Rate
- **Check prompt structure**: Static content should come first
- **Verify token counts**: Must meet minimum thresholds
- **Review content types**: Ensure static content is actually static

#### 3. Unexpected Costs
- **Cache creation costs**: First request creates cache
- **Storage costs**: Gemini charges for cache storage
- **TTL expiration**: Caches expire and need recreation

### Debug Headers
Enable detailed cache logging:
```bash
curl -H "CostKatana-Debug-Cache: true" \
     -H "Authorization: Bearer YOUR_KEY" \
     https://api.costkatana.com/v1/chat/completions
```

## Provider-Specific Notes

### Anthropic Claude
- Use `cache_control: {"type": "ephemeral"}` on static content
- Maximum 4 cache breakpoints per request
- Cache TTL: 5 minutes
- Works with all Claude 3.5+ and 4.0+ models

### OpenAI GPT
- Automatic prefix matching - no explicit markers needed
- Works with GPT-4o, GPT-4o-mini, o1, o1-mini
- Cache TTL: 5-10 minutes
- 50% discount on cached tokens

### Google Gemini
- Requires explicit cache creation via API
- Higher minimum token threshold (32K)
- Configurable TTL (5 min to 24 hours)
- Storage costs apply for long-lived caches

## Performance Benchmarks

### Latency Improvements
- **Claude 3.5 Sonnet**: 60-80% faster for cached prefixes
- **GPT-4o**: 50-70% faster for cached prefixes
- **Gemini 2.5 Pro**: 70-85% faster for cached contexts

### Cost Savings by Use Case
- **Document Q&A**: 60-75% cost reduction
- **Code Analysis**: 50-70% cost reduction
- **System Prompts**: 30-50% cost reduction
- **Repeated Tasks**: 40-65% cost reduction

## Future Enhancements

### Planned Features
1. **Semantic Caching**: Cache across similar prompts (not just identical prefixes)
2. **Cross-Provider Caching**: Cache optimization across different providers
3. **Dynamic Cache Management**: Automatic cache invalidation and refresh
4. **Cache Analytics Dashboard**: Detailed cache performance visualization
5. **Custom TTL Management**: User-configurable cache lifetimes

### Research Areas
- **Hybrid Caching**: Combine prompt caching with semantic caching
- **Adaptive Breakpoints**: AI-optimized cache breakpoint placement
- **Cache Compression**: Further reduce cache storage costs
- **Federated Caching**: Share caches across user organizations

## Support

For issues or questions about prompt caching:

1. Check the [API Documentation](https://docs.costkatana.com)
2. Review [Provider-Specific Guides](https://docs.costkatana.com/providers)
3. Contact support at support@costkatana.com
4. Join our [Discord Community](https://discord.gg/costkatana)

## Changelog

### v1.0.0 (Current)
- Initial implementation of prompt caching
- Support for Anthropic, OpenAI, and Google Gemini
- Automatic prompt structure optimization
- Cache performance monitoring and analytics
- Optimization recommendations engine

### Upcoming
- Semantic caching across similar prompts
- Cross-provider cache sharing
- Advanced cache analytics dashboard
- Custom cache TTL management