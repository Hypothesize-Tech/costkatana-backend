import { loggingService } from '../services/logging.service';
import { telemetryConfig } from '../config/telemetry';
import { trace } from '@opentelemetry/api';

/**
 * Validate telemetry configuration on startup
 */
export async function validateTelemetryConfig(): Promise<string[]> {
  const startTime = Date.now();
  
  loggingService.info('=== TELEMETRY CONFIGURATION VALIDATION STARTED ===', {
    component: 'TelemetryValidator',
    operation: 'validateTelemetryConfig',
    type: 'telemetry_validation',
    step: 'started'
  });

  const issues: string[] = [];
  
  try {
    loggingService.info('Step 1: Retrieving telemetry configuration', {
      component: 'TelemetryValidator',
      operation: 'validateTelemetryConfig',
      type: 'telemetry_validation',
      step: 'get_config'
    });

    // Get configuration
    const config = telemetryConfig.getConfig();
    
    loggingService.info('Telemetry configuration retrieved', {
      component: 'TelemetryValidator',
      operation: 'validateTelemetryConfig',
      type: 'telemetry_validation',
      step: 'config_retrieved',
      enabled: config.enabled,
      serviceName: config.serviceName,
      environment: config.environment
    });

    // Check if telemetry is disabled
    if (!config.enabled) {
      loggingService.info('📊 Telemetry is disabled via TELEMETRY_ENABLED=false', {
        component: 'TelemetryValidator',
        operation: 'validateTelemetryConfig',
        type: 'telemetry_validation',
        step: 'telemetry_disabled',
        reason: 'TELEMETRY_ENABLED=false'
      });
      return [];
    }

    loggingService.info('Step 2: Validating telemetry configuration', {
      component: 'TelemetryValidator',
      operation: 'validateTelemetryConfig',
      type: 'telemetry_validation',
      step: 'validate_config'
    });

    // Validate configuration
    const validation = await telemetryConfig.validate();
    issues.push(...validation.issues);

    loggingService.info('Configuration validation completed', {
      component: 'TelemetryValidator',
      operation: 'validateTelemetryConfig',
      type: 'telemetry_validation',
      step: 'config_validated',
      issuesFound: validation.issues.length,
      issues: validation.issues
    });

    loggingService.info('Step 3: Checking OpenTelemetry SDK initialization', {
      component: 'TelemetryValidator',
      operation: 'validateTelemetryConfig',
      type: 'telemetry_validation',
      step: 'check_sdk'
    });

    // Check OpenTelemetry SDK initialization
    const tracer = trace.getTracer('validation');
    
    try {
      // Create a test span to verify tracing works
      const testSpan = tracer.startSpan('telemetry.validation.test');
      testSpan.setAttribute('test', true);
      testSpan.end();

      loggingService.info('OpenTelemetry SDK test span created successfully', {
        component: 'TelemetryValidator',
        operation: 'validateTelemetryConfig',
        type: 'telemetry_validation',
        step: 'sdk_test_passed',
        spanName: 'telemetry.validation.test'
      });
    } catch (error) {
      const errorMessage = `OpenTelemetry SDK not properly initialized: ${error}`;
      issues.push(errorMessage);
      
      loggingService.error('OpenTelemetry SDK test span failed', {
        component: 'TelemetryValidator',
        operation: 'validateTelemetryConfig',
        type: 'telemetry_validation',
        step: 'sdk_test_failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    }

    loggingService.info('Step 4: Validating vendor-specific configuration', {
      component: 'TelemetryValidator',
      operation: 'validateTelemetryConfig',
      type: 'telemetry_validation',
      step: 'validate_vendor'
    });

    // Check vendor-specific requirements
    const vendorConfig = telemetryConfig.getVendorConfig();
    if (vendorConfig) {
      loggingService.info('Vendor configuration found, validating requirements', {
        component: 'TelemetryValidator',
        operation: 'validateTelemetryConfig',
        type: 'telemetry_validation',
        step: 'vendor_config_found',
        vendor: vendorConfig.vendor
      });

      const vendorIssues = validateVendorConfig(vendorConfig);
      issues.push(...vendorIssues);

      loggingService.info('Vendor configuration validation completed', {
        component: 'TelemetryValidator',
        operation: 'validateTelemetryConfig',
        type: 'telemetry_validation',
        step: 'vendor_validated',
        vendor: vendorConfig.vendor,
        issuesFound: vendorIssues.length,
        issues: vendorIssues
      });
    } else {
      loggingService.info('No vendor-specific configuration found', {
        component: 'TelemetryValidator',
        operation: 'validateTelemetryConfig',
        type: 'telemetry_validation',
        step: 'no_vendor_config'
      });
    }

    loggingService.info('Step 5: Finalizing validation results', {
      component: 'TelemetryValidator',
      operation: 'validateTelemetryConfig',
      type: 'telemetry_validation',
      step: 'finalize_results'
    });

    // Log final status
    if (issues.length === 0) {
      loggingService.info('✅ Telemetry validation passed', {
        component: 'TelemetryValidator',
        operation: 'validateTelemetryConfig',
        type: 'telemetry_validation',
        step: 'validation_passed',
        serviceName: config.serviceName,
        environment: config.environment,
        vendor: vendorConfig?.vendor,
        totalTime: `${Date.now() - startTime}ms`
      });
    } else {
      loggingService.warn('⚠️  Telemetry validation completed with issues', {
        component: 'TelemetryValidator',
        operation: 'validateTelemetryConfig',
        type: 'telemetry_validation',
        step: 'validation_with_issues',
        issues,
        issueCount: issues.length,
        resolution: 'Telemetry will work but may be limited',
        totalTime: `${Date.now() - startTime}ms`
      });
    }

    loggingService.info('=== TELEMETRY CONFIGURATION VALIDATION COMPLETED ===', {
      component: 'TelemetryValidator',
      operation: 'validateTelemetryConfig',
      type: 'telemetry_validation',
      step: 'completed',
      totalIssues: issues.length,
      totalTime: `${Date.now() - startTime}ms`
    });

    return issues;
  } catch (error) {
    const errorMessage = `Validation error: ${error}`;
    issues.push(errorMessage);
    
    loggingService.error('❌ Telemetry validation failed', {
      component: 'TelemetryValidator',
      operation: 'validateTelemetryConfig',
      type: 'telemetry_validation',
      step: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      totalTime: `${Date.now() - startTime}ms`
    });
    
    return issues;
  }
}

/**
 * Validate vendor-specific configuration
 */
function validateVendorConfig(vendorConfig: { vendor: string; config: any }): string[] {
  const startTime = Date.now();
  
  loggingService.debug('=== VENDOR CONFIGURATION VALIDATION STARTED ===', {
    component: 'TelemetryValidator',
    operation: 'validateVendorConfig',
    type: 'vendor_validation',
    step: 'started',
    vendor: vendorConfig.vendor
  });

  const issues: string[] = [];
  const { vendor, config } = vendorConfig;

  loggingService.debug('Step 1: Validating vendor-specific requirements', {
    component: 'TelemetryValidator',
    operation: 'validateVendorConfig',
    type: 'vendor_validation',
    step: 'validate_requirements',
    vendor
  });

  switch (vendor) {
    case 'datadog':
      if (!config.apiKey && !process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('DD-API-KEY')) {
        const issue = 'Datadog requires DD_API_KEY or API key in OTEL_EXPORTER_OTLP_HEADERS';
        issues.push(issue);
        
        loggingService.warn('Datadog configuration issue detected', {
          component: 'TelemetryValidator',
          operation: 'validateVendorConfig',
          type: 'vendor_validation',
          step: 'datadog_issue',
          vendor,
          issue,
          hasApiKey: !!config.apiKey,
          hasHeader: !!process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('DD-API-KEY')
        });
      }
      break;

    case 'newrelic':
      if (!config.apiKey && !process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('Api-Key')) {
        const issue = 'New Relic requires NEW_RELIC_API_KEY or API key in OTEL_EXPORTER_OTLP_HEADERS';
        issues.push(issue);
        
        loggingService.warn('New Relic configuration issue detected', {
          component: 'TelemetryValidator',
          operation: 'validateVendorConfig',
          type: 'vendor_validation',
          step: 'newrelic_issue',
          vendor,
          issue,
          hasApiKey: !!config.apiKey,
          hasHeader: !!process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('Api-Key')
        });
      }
      if (!config.accountId) {
        const issue = 'New Relic requires NEW_RELIC_ACCOUNT_ID';
        issues.push(issue);
        
        loggingService.warn('New Relic account ID missing', {
          component: 'TelemetryValidator',
          operation: 'validateVendorConfig',
          type: 'vendor_validation',
          step: 'newrelic_account_issue',
          vendor,
          issue,
          hasAccountId: !!config.accountId
        });
      }
      break;

    case 'grafana':
      if (!config.apiKey && !process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('Authorization')) {
        const issue = 'Grafana Cloud requires GRAFANA_API_KEY or auth in OTEL_EXPORTER_OTLP_HEADERS';
        issues.push(issue);
        
        loggingService.warn('Grafana configuration issue detected', {
          component: 'TelemetryValidator',
          operation: 'validateVendorConfig',
          type: 'vendor_validation',
          step: 'grafana_issue',
          vendor,
          issue,
          hasApiKey: !!config.apiKey,
          hasHeader: !!process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('Authorization')
        });
      }
      if (!config.instanceId) {
        const issue = 'Grafana Cloud requires GRAFANA_INSTANCE_ID';
        issues.push(issue);
        
        loggingService.warn('Grafana instance ID missing', {
          component: 'TelemetryValidator',
          operation: 'validateVendorConfig',
          type: 'vendor_validation',
          step: 'grafana_instance_issue',
          vendor,
          issue,
          hasInstanceId: !!config.instanceId
        });
      }
      break;

    case 'honeycomb':
      if (!config.apiKey && !process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('x-honeycomb-team')) {
        const issue = 'Honeycomb requires HONEYCOMB_API_KEY or team key in OTEL_EXPORTER_OTLP_HEADERS';
        issues.push(issue);
        
        loggingService.warn('Honeycomb configuration issue detected', {
          component: 'TelemetryValidator',
          operation: 'validateVendorConfig',
          type: 'vendor_validation',
          step: 'honeycomb_issue',
          vendor,
          issue,
          hasApiKey: !!config.apiKey,
          hasHeader: !!process.env.OTEL_EXPORTER_OTLP_HEADERS?.includes('x-honeycomb-team')
        });
      }
      break;
  }

  loggingService.debug('Vendor configuration validation completed', {
    component: 'TelemetryValidator',
    operation: 'validateVendorConfig',
    type: 'vendor_validation',
    step: 'completed',
    vendor,
    issuesFound: issues.length,
    totalTime: `${Date.now() - startTime}ms`
  });

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
  const startTime = Date.now();
  
  loggingService.info('=== TELEMETRY HEALTH CHECK STARTED ===', {
    component: 'TelemetryValidator',
    operation: 'checkTelemetryHealth',
    type: 'telemetry_health',
    step: 'started'
  });

  const errors: string[] = [];
  const details = {
    sdk: false,
    collector: false,
    exporter: false,
    storage: false
  };

  try {
    loggingService.info('Step 1: Checking OpenTelemetry SDK health', {
      component: 'TelemetryValidator',
      operation: 'checkTelemetryHealth',
      type: 'telemetry_health',
      step: 'check_sdk'
    });

    // Check SDK
    try {
      const tracer = trace.getTracer('health-check');
      const span = tracer.startSpan('health.check');
      span.end();
      details.sdk = true;
      
      loggingService.info('OpenTelemetry SDK health check passed', {
        component: 'TelemetryValidator',
        operation: 'checkTelemetryHealth',
        type: 'telemetry_health',
        step: 'sdk_healthy',
        spanName: 'health.check'
      });
    } catch (error) {
      const errorMessage = `SDK check failed: ${error}`;
      errors.push(errorMessage);
      
      loggingService.error('OpenTelemetry SDK health check failed', {
        component: 'TelemetryValidator',
        operation: 'checkTelemetryHealth',
        type: 'telemetry_health',
        step: 'sdk_unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    }

    loggingService.info('Step 2: Checking collector health', {
      component: 'TelemetryValidator',
      operation: 'checkTelemetryHealth',
      type: 'telemetry_health',
      step: 'check_collector'
    });

    // Check collector
    try {
      const collectorHealthy = await telemetryConfig.checkCollectorHealth();
      details.collector = collectorHealthy;
      
      if (collectorHealthy) {
        loggingService.info('Collector health check passed', {
          component: 'TelemetryValidator',
          operation: 'checkTelemetryHealth',
          type: 'telemetry_health',
          step: 'collector_healthy'
        });
      } else {
        const errorMessage = 'Collector is not healthy or unreachable';
        errors.push(errorMessage);
        
        loggingService.warn('Collector health check failed', {
          component: 'TelemetryValidator',
          operation: 'checkTelemetryHealth',
          type: 'telemetry_health',
          step: 'collector_unhealthy',
          error: errorMessage
        });
      }
    } catch (error) {
      const errorMessage = `Collector check failed: ${error}`;
      errors.push(errorMessage);
      
      loggingService.error('Collector health check error', {
        component: 'TelemetryValidator',
        operation: 'checkTelemetryHealth',
        type: 'telemetry_health',
        step: 'collector_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    }

    loggingService.info('Step 3: Checking exporter health', {
      component: 'TelemetryValidator',
      operation: 'checkTelemetryHealth',
      type: 'telemetry_health',
      step: 'check_exporter'
    });

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
      
      loggingService.info('Exporter health check passed', {
        component: 'TelemetryValidator',
        operation: 'checkTelemetryHealth',
        type: 'telemetry_health',
        step: 'exporter_healthy',
        spanName: 'health.exporter.test'
      });
    } catch (error) {
      const errorMessage = `Exporter check failed: ${error}`;
      errors.push(errorMessage);
      
      loggingService.error('Exporter health check failed', {
        component: 'TelemetryValidator',
        operation: 'checkTelemetryHealth',
        type: 'telemetry_health',
        step: 'exporter_unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    }

    loggingService.info('Step 4: Checking storage health', {
      component: 'TelemetryValidator',
      operation: 'checkTelemetryHealth',
      type: 'telemetry_health',
      step: 'check_storage'
    });

    // Check MongoDB storage
    try {
      const { Telemetry } = await import('../models/Telemetry');
      await Telemetry.countDocuments().limit(1);
      details.storage = true;
      
      loggingService.info('Storage health check passed', {
        component: 'TelemetryValidator',
        operation: 'checkTelemetryHealth',
        type: 'telemetry_health',
        step: 'storage_healthy',
        model: 'Telemetry'
      });
    } catch (error) {
      const errorMessage = `Storage check failed: ${error}`;
      errors.push(errorMessage);
      
      loggingService.error('Storage health check failed', {
        component: 'TelemetryValidator',
        operation: 'checkTelemetryHealth',
        type: 'telemetry_health',
        step: 'storage_unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        model: 'Telemetry'
      });
    }

    const healthy = details.sdk && details.exporter && details.storage;

    loggingService.info('Telemetry health check completed', {
      component: 'TelemetryValidator',
      operation: 'checkTelemetryHealth',
      type: 'telemetry_health',
      step: 'completed',
      healthy,
      details,
      errorCount: errors.length,
      totalTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== TELEMETRY HEALTH CHECK COMPLETED ===', {
      component: 'TelemetryValidator',
      operation: 'checkTelemetryHealth',
      type: 'telemetry_health',
      step: 'completed',
      healthy,
      totalTime: `${Date.now() - startTime}ms`
    });

    return {
      healthy,
      details,
      errors
    };
  } catch (error) {
    loggingService.error('Telemetry health check failed', {
      component: 'TelemetryValidator',
      operation: 'checkTelemetryHealth',
      type: 'telemetry_health',
      step: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      totalTime: `${Date.now() - startTime}ms`
    });

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
  const startTime = Date.now();
  
  loggingService.info('=== TEST TELEMETRY GENERATION STARTED ===', {
    component: 'TelemetryValidator',
    operation: 'generateTestTelemetry',
    type: 'test_telemetry',
    step: 'started'
  });

  const tracer = trace.getTracer('test-generator');
  
  loggingService.info('Step 1: Generating HTTP request test span', {
    component: 'TelemetryValidator',
    operation: 'generateTestTelemetry',
    type: 'test_telemetry',
    step: 'generate_http_span'
  });

  // Generate various types of spans
  await tracer.startActiveSpan('test.http.request', async (span) => {
    span.setAttribute('http.method', 'GET');
    span.setAttribute('http.route', '/test');
    span.setAttribute('http.status_code', 200);
    
    loggingService.info('HTTP request test span created', {
      component: 'TelemetryValidator',
      operation: 'generateTestTelemetry',
      type: 'test_telemetry',
      step: 'http_span_created',
      spanName: 'test.http.request',
      attributes: {
        method: 'GET',
        route: '/test',
        statusCode: 200
      }
    });
    
    loggingService.info('Step 2: Generating database query test span', {
      component: 'TelemetryValidator',
      operation: 'generateTestTelemetry',
      type: 'test_telemetry',
      step: 'generate_db_span'
    });

    // Simulate nested operation
    await tracer.startActiveSpan('test.database.query', async (dbSpan) => {
      dbSpan.setAttribute('db.system', 'mongodb');
      dbSpan.setAttribute('db.operation', 'find');
      dbSpan.setAttribute('db.collection', 'test');
      await new Promise(resolve => setTimeout(resolve, 50));
      dbSpan.end();
      
      loggingService.debug('Database query test span created', {
        component: 'TelemetryValidator',
        operation: 'generateTestTelemetry',
        type: 'test_telemetry',
        step: 'db_span_created',
        spanName: 'test.database.query',
        attributes: {
          system: 'mongodb',
          operation: 'find',
          collection: 'test'
        }
      });
    });
    
    loggingService.info('Step 3: Generating AI completion test span', {
      component: 'TelemetryValidator',
      operation: 'generateTestTelemetry',
      type: 'test_telemetry',
      step: 'generate_ai_span'
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
      
      loggingService.debug('AI completion test span created', {
        component: 'TelemetryValidator',
        operation: 'generateTestTelemetry',
        type: 'test_telemetry',
        step: 'ai_span_created',
        spanName: 'test.gen_ai.completion',
        attributes: {
          system: 'test',
          model: 'test-model',
          promptTokens: 100,
          completionTokens: 50,
          cost: 0.001
        }
      });
    });
    
    span.end();
  });
  
  loggingService.info('📊 Test telemetry generated successfully', {
    component: 'TelemetryValidator',
    operation: 'generateTestTelemetry',
    type: 'test_telemetry',
    step: 'completed',
    totalTime: `${Date.now() - startTime}ms`
  });

  loggingService.info('=== TEST TELEMETRY GENERATION COMPLETED ===', {
    component: 'TelemetryValidator',
    operation: 'generateTestTelemetry',
    type: 'test_telemetry',
    step: 'completed',
    totalTime: `${Date.now() - startTime}ms`
  });
}

/**
 * Collector watchdog to ensure collector stays healthy
 */
export function startCollectorWatchdog(): void {
  const startTime = Date.now();
  
  loggingService.info('=== COLLECTOR WATCHDOG STARTED ===', {
    component: 'TelemetryValidator',
    operation: 'startCollectorWatchdog',
    type: 'collector_watchdog',
    step: 'started'
  });

  if (!process.env.ENABLE_COLLECTOR_WATCHDOG) {
    loggingService.info('Collector watchdog disabled via ENABLE_COLLECTOR_WATCHDOG=false', {
      component: 'TelemetryValidator',
      operation: 'startCollectorWatchdog',
      type: 'collector_watchdog',
      step: 'disabled',
      reason: 'ENABLE_COLLECTOR_WATCHDOG not set'
    });
    return;
  }

  const checkInterval = parseInt(process.env.COLLECTOR_WATCHDOG_INTERVAL || '60000', 10);
  
  loggingService.info('Step 1: Setting up collector health check interval', {
    component: 'TelemetryValidator',
    operation: 'startCollectorWatchdog',
    type: 'collector_watchdog',
    step: 'setup_interval',
    checkInterval: `${checkInterval}ms`
  });

  setInterval(async () => {
    try {
      loggingService.debug('Collector watchdog health check triggered', {
        component: 'TelemetryValidator',
        operation: 'startCollectorWatchdog',
        type: 'collector_watchdog',
        step: 'health_check_triggered'
      });

      const healthy = await telemetryConfig.checkCollectorHealth();
      
      if (!healthy) {
        loggingService.warn('⚠️  Collector unhealthy, attempting restart...', {
          component: 'TelemetryValidator',
          operation: 'startCollectorWatchdog',
          type: 'collector_watchdog',
          step: 'restart_attempt',
          reason: 'Collector health check failed'
        });
        
        // Attempt to restart collector
        const { spawn } = await import('child_process');
        const restart = spawn('npm', ['run', 'otel:restart'], {
          stdio: 'inherit',
          shell: true
        });
        
        restart.on('error', (error) => {
          loggingService.error('Failed to restart collector', {
            component: 'TelemetryValidator',
            operation: 'startCollectorWatchdog',
            type: 'collector_watchdog',
            step: 'restart_failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
          });
        });

        restart.on('exit', (code) => {
          if (code === 0) {
            loggingService.info('Collector restart command executed successfully', {
              component: 'TelemetryValidator',
              operation: 'startCollectorWatchdog',
              type: 'collector_watchdog',
              step: 'restart_executed',
              exitCode: code
            });
          } else {
            loggingService.warn('Collector restart command exited with non-zero code', {
              component: 'TelemetryValidator',
              operation: 'startCollectorWatchdog',
              type: 'collector_watchdog',
              step: 'restart_exited',
              exitCode: code
            });
          }
        });
      } else {
        loggingService.debug('Collector health check passed', {
          component: 'TelemetryValidator',
          operation: 'startCollectorWatchdog',
          type: 'collector_watchdog',
          step: 'health_check_passed'
        });
      }
    } catch (error) {
      loggingService.error('Collector watchdog error', {
        component: 'TelemetryValidator',
        operation: 'startCollectorWatchdog',
        type: 'collector_watchdog',
        step: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }, checkInterval);
  
  loggingService.info('🐕 Collector watchdog started successfully', {
    component: 'TelemetryValidator',
    operation: 'startCollectorWatchdog',
    type: 'collector_watchdog',
    step: 'completed',
    interval: `${checkInterval}ms`,
    totalTime: `${Date.now() - startTime}ms`
  });

  loggingService.info('=== COLLECTOR WATCHDOG COMPLETED ===', {
    component: 'TelemetryValidator',
    operation: 'startCollectorWatchdog',
    type: 'collector_watchdog',
    step: 'completed',
    totalTime: `${Date.now() - startTime}ms`
  });
}
