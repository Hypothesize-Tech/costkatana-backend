/**
 * OpenTelemetry Registration
 * 
 * This file is loaded via the -r flag before any other imports
 * to ensure that OpenTelemetry instrumentation is initialized first.
 */

import { startTelemetry } from './otel';
import { loggingService } from '../services/logging.service';

// Disable exporters in development mode to prevent connection errors
if (process.env.NODE_ENV !== 'production' && !process.env.OTLP_URL) {
  process.env.OTEL_TRACES_EXPORTER = 'none';
  process.env.OTEL_METRICS_EXPORTER = 'none';
  
  loggingService.info('🔄 OpenTelemetry: Development mode - exporters disabled', {
    component: 'OpenTelemetryRegistration',
    operation: 'register',
    type: 'telemetry_registration',
    step: 'development_mode_detected',
    environment: process.env.NODE_ENV,
    hasOTLPUrl: !!process.env.OTLP_URL,
    tracesExporter: process.env.OTEL_TRACES_EXPORTER,
    metricsExporter: process.env.OTEL_METRICS_EXPORTER
  });
}

// Start telemetry as early as possible
(async () => {
  const startTime = Date.now();
  
  loggingService.info('=== OPENTELEMETRY REGISTRATION STARTED ===', {
    component: 'OpenTelemetryRegistration',
    operation: 'register',
    type: 'telemetry_registration',
    step: 'started'
  });

  try {
    loggingService.info('Step 1: Starting OpenTelemetry initialization', {
      component: 'OpenTelemetryRegistration',
      operation: 'register',
      type: 'telemetry_registration',
      step: 'start_initialization'
    });

    await startTelemetry();
    
    loggingService.info('OpenTelemetry initialized successfully', {
      component: 'OpenTelemetryRegistration',
      operation: 'register',
      type: 'telemetry_registration',
      step: 'initialization_completed',
      totalTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== OPENTELEMETRY REGISTRATION COMPLETED ===', {
      component: 'OpenTelemetryRegistration',
      operation: 'register',
      type: 'telemetry_registration',
      step: 'completed',
      totalTime: `${Date.now() - startTime}ms`
    });

  } catch (error) {
    loggingService.error('OpenTelemetry initialization failed', {
      component: 'OpenTelemetryRegistration',
      operation: 'register',
      type: 'telemetry_registration',
      step: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      totalTime: `${Date.now() - startTime}ms`
    });
  }
})();
