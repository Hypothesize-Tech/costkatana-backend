# Cost Katana Observability Guide

## Overview

This guide covers the enterprise-grade OpenTelemetry (OTel) integration for Cost Katana, providing comprehensive observability for traces, metrics, and logs correlation.

## Quick Start

### Prerequisites

```bash
# Install dependencies
npm install

# Install OpenTelemetry Collector
npm run otel:install
```

### Configuration

1. Copy the environment template:
```bash
cp env.example .env
```

2. Configure your telemetry destination (choose one mode below).

## Deployment Modes

### Mode A: Direct to Vendor (Recommended for Production)

Send telemetry directly to your APM vendor (Grafana Cloud, Datadog, New Relic, etc.).

#### Grafana Cloud Example

```env
# .env configuration
OTLP_HTTP_TRACES_URL=https://tempo-prod-us-central1.grafana.net/tempo/api/push
OTLP_HTTP_METRICS_URL=https://prometheus-prod-us-central1.grafana.net/api/prom/push
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer glc_YOUR_TOKEN_HERE
```

#### Datadog Example

```env
OTLP_HTTP_TRACES_URL=https://trace.agent.datadoghq.com/v0.7/traces
OTLP_HTTP_METRICS_URL=https://api.datadoghq.com/v1/series
OTEL_EXPORTER_OTLP_HEADERS=DD-API-KEY=YOUR_API_KEY
```

#### New Relic Example

```env
OTLP_HTTP_TRACES_URL=https://otlp.nr-data.net:4318/v1/traces
OTLP_HTTP_METRICS_URL=https://otlp.nr-data.net:4318/v1/metrics
OTEL_EXPORTER_OTLP_HEADERS=api-key=YOUR_LICENSE_KEY
```

### Mode B: Local OTel Collector

Run the OpenTelemetry Collector locally as a single binary.

```bash
# Start the collector
npm run otel:run

# Verify it's running
curl http://localhost:13133/health

# View metrics
curl http://localhost:9464/metrics

# Stop the collector
npm run otel:stop
```

### Mode C: Local Visualization Stack (Development)

Run individual Docker containers for local visualization (no docker-compose).

```bash
# 1. Start Tempo (Traces)
docker run -d --name tempo \
  -p 3200:3200 \
  -p 4317:4317 \
  -p 4318:4318 \
  -v $(pwd)/ops/tempo-config.yaml:/etc/tempo.yaml \
  grafana/tempo:latest \
  -config.file=/etc/tempo.yaml

# 2. Start Prometheus (Metrics)
docker run -d --name prometheus \
  -p 9090:9090 \
  -v $(pwd)/ops/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus:latest

# 3. Start Grafana (Dashboards)
docker run -d --name grafana \
  -p 3000:3000 \
  -e GF_AUTH_ANONYMOUS_ENABLED=true \
  -e GF_AUTH_ANONYMOUS_ORG_ROLE=Admin \
  grafana/grafana:latest

# Access points:
# - Grafana: http://localhost:3000
# - Prometheus: http://localhost:9090
# - Tempo: http://localhost:3200
```

## Features

### 1. Distributed Tracing

- **Automatic instrumentation** for Express, MongoDB, HTTP clients
- **W3C Trace Context** propagation
- **Custom spans** for LLM operations
- **Baggage propagation** for tenant/workspace/user context

### 2. Metrics Collection

- **RED metrics** (Rate, Errors, Duration) for all HTTP endpoints
- **GenAI metrics**: Token usage, costs, latency per model/provider
- **Business metrics**: User registrations, projects created, optimizations
- **System metrics**: Memory, CPU, active connections

### 3. Log Correlation

- **Automatic trace_id/span_id injection** in all logs
- **Structured logging** with Winston + OpenTelemetry context
- **Privacy-preserving** log redaction

### 4. GenAI Observability

- **Token tracking**: Prompt, completion, and total tokens
- **Cost attribution**: Per request, model, tenant, workspace
- **Model performance**: Latency, error rates, success rates
- **High-cost detection**: Automatic alerting for expensive operations (>$0.01)

## Privacy & Security

### Data Redaction

By default, the following data is redacted:

- Model prompts and completions (unless `CK_CAPTURE_MODEL_TEXT=true`)
- HTTP request/response bodies
- Authorization headers and API keys
- Email addresses, phone numbers, SSNs
- Credit card numbers

### Regional Data Residency

Configure regional routing via baggage:

```javascript
// Set tenant region in request headers
headers: {
  'x-tenant-region': 'eu' // Routes to EU collector
}
```

### Secure Transport

```env
# TLS Configuration
OTEL_EXPORTER_OTLP_CERTIFICATE=/path/to/cert.pem
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer YOUR_SECURE_TOKEN
```

## Sampling Strategy

The collector implements intelligent tail sampling:

1. **Always keep**: Errors (100%)
2. **Always keep**: High-cost operations ≥ $0.01 (100%)
3. **Always keep**: Slow requests > 2000ms (100%)
4. **Probabilistic**: Everything else (10%)

## Dashboards

Import the provided Grafana dashboards:

1. **API RED Metrics** (`ops/observability/dashboards/api-red-metrics.json`)
   - Request rate, error rate, duration percentiles
   - Status code distribution, top endpoints

2. **GenAI Cost & Tokens** (`ops/observability/dashboards/genai-cost-tokens.json`)
   - Total costs, token usage, cost trends
   - Cost by model/provider/tenant
   - High-cost operation detection

## Alerts

Example Prometheus alert rules:

```yaml
# High Error Rate
- alert: HighErrorRate
  expr: rate(http_server_request_count{status_class="5xx"}[5m]) > 0.02
  for: 5m
  annotations:
    summary: "High error rate detected"

# High LLM Cost
- alert: HighLLMCost
  expr: increase(costkatana_llm_cost[1h]) > 10
  for: 10m
  annotations:
    summary: "LLM costs exceeded $10 in the last hour"

# No Telemetry Data
- alert: NoTelemetryData
  expr: up{job="otel-collector"} == 0
  for: 10m
  annotations:
    summary: "OpenTelemetry Collector is down"
```

## Performance Impact

- **CPU overhead**: < 2% with default configuration
- **Memory overhead**: ~50MB for collector, ~20MB for SDK
- **Latency impact**: < 1ms per request
- **Network overhead**: Batched exports every 200ms

## Troubleshooting

### Check Collector Status

```bash
# Health check
curl http://localhost:13133/health

# View collector metrics
curl http://localhost:9464/metrics | grep otelcol

# Check logs
tail -f logs/otel-collector.log
```

### Verify Trace Context

```bash
# Make a request and check for trace headers
curl -v http://localhost:8000/api/health

# Look for:
# X-Request-Id: <ulid>
# Traceparent: 00-<trace-id>-<span-id>-01
```

### Debug Telemetry

```javascript
// Enable debug logging
process.env.OTEL_LOG_LEVEL = 'debug';

// Check if telemetry is initialized
import { isTelemetryInitialized } from './observability/otel';
console.log('Telemetry initialized:', isTelemetryInitialized());
```

### Common Issues

1. **No traces appearing**
   - Check OTLP endpoint configuration
   - Verify network connectivity
   - Check authentication headers

2. **Missing metrics**
   - Ensure Prometheus is scraping the collector (`:9464/metrics`)
   - Verify metric names in queries

3. **High memory usage**
   - Adjust batch size in collector config
   - Enable memory limiter processor
   - Reduce sampling rate

## API Integration

### Manual Span Creation

```javascript
import { createGenAISpan } from './utils/genaiTelemetry';

const result = await createGenAISpan('custom_operation', async (span) => {
  span.setAttribute('custom.attribute', 'value');
  // Your code here
  return result;
});
```

### Record GenAI Usage

```javascript
import { recordGenAIUsage } from './utils/genaiTelemetry';

recordGenAIUsage({
  provider: 'openai',
  operationName: 'chat.completions',
  model: 'gpt-4',
  promptTokens: 100,
  completionTokens: 50,
  costUSD: 0.0075,
  latencyMs: 1234
});
```

### Business Metrics

```javascript
import { businessMetrics } from './middleware/requestMetrics';

// Track custom business events
businessMetrics.userRegistrations.add(1, { plan: 'premium' });
businessMetrics.costSavings.record(25.50, { optimization_type: 'model_switch' });
```

## Cost Optimization Tips

1. **Monitor high-cost operations**
   - Set up alerts for operations > $0.01
   - Review the GenAI dashboard daily

2. **Optimize sampling**
   - Reduce probabilistic sampling in development
   - Keep 100% sampling for errors and high-cost ops

3. **Use regional collectors**
   - Deploy collectors close to your services
   - Minimize cross-region data transfer

4. **Batch operations**
   - Adjust batch size based on traffic patterns
   - Use compression for OTLP exports

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review collector logs: `tail -f logs/otel-collector.log`
3. Open an issue on GitHub with:
   - Environment details
   - Configuration (redact sensitive data)
   - Error messages and logs
