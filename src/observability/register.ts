/**
 * OpenTelemetry & Sentry Registration
 *
 * This file is loaded via the -r flag before any other imports
 * to ensure that OpenTelemetry and Sentry instrumentation are initialized first.
 */

import { startTelemetry } from './otel';
import { initializeSentry, isSentryEnabled } from '../config/sentry';
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

// Start telemetry and Sentry as early as possible
(async () => {
  const startTime = Date.now();

  loggingService.info('=== OPENTELEMETRY & SENTRY REGISTRATION STARTED ===', {
    component: 'ObservabilityRegistration',
    operation: 'register',
    type: 'observability_registration',
    step: 'started'
  });

  try {
    // Initialize Sentry first (lightweight, synchronous)
    loggingService.info('Step 1: Initializing Sentry error tracking', {
      component: 'ObservabilityRegistration',
      operation: 'register',
      type: 'observability_registration',
      step: 'sentry_initialization'
    });

    initializeSentry();

    if (isSentryEnabled()) {
      loggingService.info('✅ Sentry initialized successfully', {
        component: 'ObservabilityRegistration',
        operation: 'register',
        type: 'observability_registration',
        step: 'sentry_completed'
      });
    } else {
      loggingService.info('ℹ️ Sentry not enabled (no DSN provided)', {
        component: 'ObservabilityRegistration',
        operation: 'register',
        type: 'observability_registration',
        step: 'sentry_disabled'
      });
    }

    // Initialize OpenTelemetry
    loggingService.info('Step 2: Starting OpenTelemetry initialization', {
      component: 'ObservabilityRegistration',
      operation: 'register',
      type: 'observability_registration',
      step: 'otel_initialization'
    });

    await startTelemetry();

    loggingService.info('✅ OpenTelemetry initialized successfully', {
      component: 'ObservabilityRegistration',
      operation: 'register',
      type: 'observability_registration',
      step: 'otel_completed',
      totalTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== OPENTELEMETRY & SENTRY REGISTRATION COMPLETED ===', {
      component: 'ObservabilityRegistration',
      operation: 'register',
      type: 'observability_registration',
      step: 'completed',
      totalTime: `${Date.now() - startTime}ms`
    });

  } catch (error) {
    loggingService.error('Observability initialization failed', {
      component: 'ObservabilityRegistration',
      operation: 'register',
      type: 'observability_registration',
      step: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      totalTime: `${Date.now() - startTime}ms`
    });
  }
})();
