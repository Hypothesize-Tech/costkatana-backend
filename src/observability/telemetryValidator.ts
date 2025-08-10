import { logger } from '../utils/logger';
import { telemetryConfig } from '../config/telemetry';
import { trace } from '@opentelemetry/api';

/**
 * Validate telemetry configuration on startup
 */
export async function validateTelemetryConfig(): Promise<string[]> {
  const issues: string[] = [];
  
  try {
    // Get configuration
    const config = telemetryConfig.getConfig();
    
    // Check if telemetry is disabled
    if (!config.enabled) {
      logger.info('📊 Telemetry is disabled via TELEMETRY_ENABLED=false');
      return [];
    }

    // Validate configuration
    const validation = await telemetryConfig.validate();
    issues.push(...validation.issues);

    // Check OpenTelemetry SDK initialization
    const tracer = trace.getTracer('validation');
    
    try {
      // Create a test span to verify tracing works
      const testSpan = tracer.startSpan('telemetry.validation.test');
      testSpan.setAttribute('test', true);
      testSpan.end();
    } catch (error) {
      issues.push(`OpenTelemetry SDK not properly initialized: ${error}`);
    }

    // Check vendor-specific requirements
    const vendorConfig = telemetryConfig.getVendorConfig();
    if (vendorConfig) {
      const vendorIssues = validateVendorConfig(vendorConfig);
      issues.push(...vendorIssues);
    }

    // Log final status
    if (issues.length === 0) {
      logger.info('✅ Telemetry validation passed', {
        serviceName: config.serviceName,
        environment: config.environment,
        vendor: vendorConfig?.vendor
      });
    } else {
      logger.warn('⚠️  Telemetry validation completed with issues:', {
        issues,
        resolution: 'Telemetry will work but may be limited'
      });
    }

    return issues;
  } catch (error) {
    logger.error('❌ Telemetry validation failed:', error);
    issues.push(`Validation error: ${error}`);
    return issues;
  }
}

/**
 * Validate vendor-specific configuration
 */
function validateVendorConfig(vendorConfig: { vendor: string; config: any }): string[] {
  const issues: string[] = [];
  const { vendor, config } = vendorConfig;

  switch (vendor) {
    case 'datadog':
      if (!config.apiKey && !process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('DD-API-KEY')) {
        issues.push('Datadog requires DD_API_KEY or API key in OTEL_EXPORTER_OTLP_HEADERS');
      }
      break;

    case 'newrelic':
      if (!config.apiKey && !process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('Api-Key')) {
        issues.push('New Relic requires NEW_RELIC_API_KEY or API key in OTEL_EXPORTER_OTLP_HEADERS');
      }
      if (!config.accountId) {
        issues.push('New Relic requires NEW_RELIC_ACCOUNT_ID');
      }
      break;

    case 'grafana':
      if (!config.apiKey && !process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('Authorization')) {
        issues.push('Grafana Cloud requires GRAFANA_API_KEY or auth in OTEL_EXPORTER_OTLP_HEADERS');
      }
      if (!config.instanceId) {
        issues.push('Grafana Cloud requires GRAFANA_INSTANCE_ID');
      }
      break;

    case 'honeycomb':
      if (!config.apiKey && !process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('x-honeycomb-team')) {
        issues.push('Honeycomb requires HONEYCOMB_API_KEY or team key in OTEL_EXPORTER_OTLP_HEADERS');
      }
      break;
  }

  return issues;
}

/**
 * Perform runtime telemetry health check
 */
export async function checkTelemetryHealth(): Promise<{
  healthy: boolean;
  details: {
    sdk: boolean;
    collector: boolean;
    exporter: boolean;
    storage: boolean;
  };
  errors: string[];
}> {
  const errors: string[] = [];
  const details = {
    sdk: false,
    collector: false,
    exporter: false,
    storage: false
  };

  try {
    // Check SDK
    try {
      const tracer = trace.getTracer('health-check');
      const span = tracer.startSpan('health.check');
      span.end();
      details.sdk = true;
    } catch (error) {
      errors.push(`SDK check failed: ${error}`);
    }

    // Check collector
    try {
      const collectorHealthy = await telemetryConfig.checkCollectorHealth();
      details.collector = collectorHealthy;
      if (!collectorHealthy) {
        errors.push('Collector is not healthy or unreachable');
      }
    } catch (error) {
      errors.push(`Collector check failed: ${error}`);
    }

    // Check exporter by attempting to send a test span
    try {
      const tracer = trace.getTracer('health-check');
      await tracer.startActiveSpan('health.exporter.test', async (span) => {
        span.setAttribute('test', true);
        span.end();
        // Give it a moment to export
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      details.exporter = true;
    } catch (error) {
      errors.push(`Exporter check failed: ${error}`);
    }

    // Check MongoDB storage
    try {
      const { Telemetry } = await import('../models/Telemetry');
      await Telemetry.countDocuments().limit(1);
      details.storage = true;
    } catch (error) {
      errors.push(`Storage check failed: ${error}`);
    }

    const healthy = details.sdk && details.exporter && details.storage;

    return {
      healthy,
      details,
      errors
    };
  } catch (error) {
    return {
      healthy: false,
      details,
      errors: [`Health check failed: ${error}`]
    };
  }
}

/**
 * Generate telemetry test data
 */
export async function generateTestTelemetry(): Promise<void> {
  const tracer = trace.getTracer('test-generator');
  
  // Generate various types of spans
  await tracer.startActiveSpan('test.http.request', async (span) => {
    span.setAttribute('http.method', 'GET');
    span.setAttribute('http.route', '/test');
    span.setAttribute('http.status_code', 200);
    
    // Simulate nested operation
    await tracer.startActiveSpan('test.database.query', async (dbSpan) => {
      dbSpan.setAttribute('db.system', 'mongodb');
      dbSpan.setAttribute('db.operation', 'find');
      dbSpan.setAttribute('db.collection', 'test');
      await new Promise(resolve => setTimeout(resolve, 50));
      dbSpan.end();
    });
    
    // Simulate AI operation
    await tracer.startActiveSpan('test.gen_ai.completion', async (aiSpan) => {
      aiSpan.setAttribute('gen_ai.system', 'test');
      aiSpan.setAttribute('gen_ai.request.model', 'test-model');
      aiSpan.setAttribute('gen_ai.usage.prompt_tokens', 100);
      aiSpan.setAttribute('gen_ai.usage.completion_tokens', 50);
      aiSpan.setAttribute('costkatana.cost.usd', 0.001);
      await new Promise(resolve => setTimeout(resolve, 100));
      aiSpan.end();
    });
    
    span.end();
  });
  
  logger.info('📊 Test telemetry generated successfully');
}

/**
 * Collector watchdog to ensure collector stays healthy
 */
export function startCollectorWatchdog(): void {
  if (!process.env.ENABLE_COLLECTOR_WATCHDOG) {
    return;
  }

  const checkInterval = parseInt(process.env.COLLECTOR_WATCHDOG_INTERVAL || '60000', 10);
  
  setInterval(async () => {
    try {
      const healthy = await telemetryConfig.checkCollectorHealth();
      
      if (!healthy) {
        logger.warn('⚠️  Collector unhealthy, attempting restart...');
        
        // Attempt to restart collector
        const { spawn } = await import('child_process');
        const restart = spawn('npm', ['run', 'otel:restart'], {
          stdio: 'inherit',
          shell: true
        });
        
        restart.on('error', (error) => {
          logger.error('Failed to restart collector:', error);
        });
      }
    } catch (error) {
      logger.error('Collector watchdog error:', error);
    }
  }, checkInterval);
  
  logger.info('🐕 Collector watchdog started', {
    interval: checkInterval
  });
}
