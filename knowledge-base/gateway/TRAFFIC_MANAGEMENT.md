# Traffic Management Architecture

## Overview

The TrafficManagementService governs request flow through the API gateway by enforcing rate limits, monitoring load, and detecting abusive patterns. It uses adaptive thresholds and integrates with MongoDB usage data and TrafficPredictionService for intelligent decisions.

## Components

### 1. Rate Limiting

- **Token Bucket**: Per-endpoint, per-user rate limiting
- **Keys**: `${endpoint}:${userId}` for traffic metrics; rate limiter key includes endpoint
- **Parameters**: `maxTokens`, `refillRate` (tokens per second), `lastRefill`
- **Refill Logic**: Tokens refill over time; request consumes tokens; insufficient tokens → 429
- **Retry-After**: Returned when rate limit exceeded so clients can back off

### 2. Traffic Metrics

Per-endpoint, per-user tracking:

| Metric              | Description                        |
|---------------------|------------------------------------|
| requestsPerMinute   | Request rate over time window      |
| averageResponseTime | Mean latency                       |
| errorRate            | Fraction of failed requests        |
| loadFactor           | Composite load indicator           |
| lastUpdated         | Timestamp of last update           |

Additional: `requestCount`, `userAgent`, `clientIp`, `method`, `statusCode`

### 3. Load Checking

`checkTrafficLoad()` uses adaptive thresholds:

| Threshold      | Check                          |
|----------------|--------------------------------|
| maxResponseTime| Average response time limit    |
| maxErrorRate   | Error rate limit               |
| maxRPM         | Requests per minute limit      |
| maxLoadFactor  | Composite load limit           |

- **Adaptive Thresholds**: `calculateAdaptiveThresholds()` uses historical data
- **Retry Time**: `calculateRetryTime()` for 429 responses
- **Fail-Open**: On error, allows request to avoid blocking legitimate traffic

### 4. Traffic Pattern Analysis

`checkTrafficPatterns()` detects:

- **Suspicious Patterns**: Unusual request rates, IP/user correlation
- **Abuse Indicators**: Burst traffic, repetitive patterns
- **Blocking**: Returns `allowed: false` when patterns indicate abuse

### 5. Request Lifecycle

```
shouldAllowRequest(endpoint, userId, clientIp, requestData)
  ├─ checkRateLimit(userId, endpoint)     → allowed? retryAfter?
  ├─ checkTrafficLoad(endpoint)           → allowed? retryAfter?
  └─ checkTrafficPatterns(...)            → allowed?

recordTrafficMetrics(endpoint, responseTime, success, userId, additionalData)
  └─ Updates trafficMetrics Map; calculates RPM, error rate, load factor
```

### 6. Integration Points

- **Usage Model**: MongoDB Usage schema for persistence
- **TrafficPredictionService**: ML-based traffic forecasting
- **Gateway Service**: Calls `shouldAllowRequest` before proxying; calls `recordTrafficMetrics` after response

### 7. Background Monitoring

- **startTrafficMonitoring()**: Periodic background job
- **Metrics Rollover**: Cleans stale entries, aggregates
- **Health Reporting**: Feeds into observability dashboards

## Configuration

Rate limits and thresholds are derived from:

- Historical endpoint performance
- User tier/plan (if applicable)
- Environment variables for overrides

## Error Handling

- **Fail-Open**: On service errors, `shouldAllowRequest` returns `allowed: true` to avoid blocking users
- **Logging**: All rejections and errors are logged with structured context
