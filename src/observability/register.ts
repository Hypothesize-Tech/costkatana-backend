/**
 * OpenTelemetry Registration
 * 
 * This file is loaded via the -r flag before any other imports
 * to ensure that OpenTelemetry instrumentation is initialized first.
 */

import { startTelemetry } from './otel';

// Disable exporters in development mode to prevent connection errors
if (process.env.NODE_ENV !== 'production' && !process.env.OTLP_URL) {
  process.env.OTEL_TRACES_EXPORTER = 'none';
  process.env.OTEL_METRICS_EXPORTER = 'none';
  console.log('🔄 OpenTelemetry: Development mode - exporters disabled');
}

// Start telemetry as early as possible
(async () => {
  try {
    await startTelemetry();
    console.log('✅ OpenTelemetry initialized successfully');
  } catch (error) {
    console.error('❌ OpenTelemetry initialization failed:', error);
  }
})();
