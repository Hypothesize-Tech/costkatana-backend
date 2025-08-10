import { logger } from '../utils/logger';
import axios from 'axios';

export interface TelemetryConfig {
  serviceName: string;
  environment: string;
  version: string;
  tracesEndpoint: string;
  metricsEndpoint: string;
  headers?: Record<string, string>;
  certificate?: string;
  insecure?: boolean;
  region?: string;
  captureModelText?: boolean;
  collectorHealthEndpoint?: string;
  enabled?: boolean;
}

/**
 * Telemetry configuration with validation
 */
export const telemetryConfig = {
  /**
   * Get validated telemetry configuration
   */
  getConfig(): TelemetryConfig {
    return {
      serviceName: process.env.OTEL_SERVICE_NAME || 'cost-katana-api',
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '2.0.0',
      tracesEndpoint: process.env.OTLP_HTTP_TRACES_URL || 'http://localhost:4318/v1/traces',
      metricsEndpoint: process.env.OTLP_HTTP_METRICS_URL || 'http://localhost:4318/v1/metrics',
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ? 
        JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS) : undefined,
      certificate: process.env.OTEL_EXPORTER_OTLP_CERTIFICATE,
      insecure: process.env.OTEL_EXPORTER_OTLP_INSECURE === 'true',
      region: process.env.CK_TELEMETRY_REGION || 'auto',
      captureModelText: process.env.CK_CAPTURE_MODEL_TEXT === 'true',
      collectorHealthEndpoint: this.getCollectorHealthEndpoint(),
      enabled: process.env.TELEMETRY_ENABLED !== 'false' // Default to enabled
    };
  },

  /**
   * Validate telemetry configuration
   */
  async validate(): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    const config = this.getConfig();

    // Check if telemetry is disabled
    if (!config.enabled) {
      logger.info('📊 Telemetry is disabled via TELEMETRY_ENABLED=false');
      return { valid: true, issues: [] };
    }

    // Validate service name
    if (!config.serviceName) {
      issues.push('Missing OTEL_SERVICE_NAME - using default: cost-katana-api');
    }

    // Validate endpoints
    if (!config.tracesEndpoint) {
      issues.push('Missing OTLP_HTTP_TRACES_URL - using default: http://localhost:4318/v1/traces');
    }

    if (!config.metricsEndpoint) {
      issues.push('Missing OTLP_HTTP_METRICS_URL - using default: http://localhost:4318/v1/metrics');
    }

    // Validate vendor-specific configurations
    if (config.tracesEndpoint.includes('datadog') && !config.headers) {
      issues.push('Datadog endpoint detected but no OTEL_EXPORTER_OTLP_HEADERS provided');
    }

    if (config.tracesEndpoint.includes('newrelic') && !config.headers) {
      issues.push('New Relic endpoint detected but no OTEL_EXPORTER_OTLP_HEADERS provided');
    }

    if (config.tracesEndpoint.includes('grafana') && !config.headers && !config.tracesEndpoint.includes('localhost')) {
      issues.push('Grafana Cloud endpoint detected but no OTEL_EXPORTER_OTLP_HEADERS provided');
    }

    // Validate regional routing
    if (config.region && !['us', 'eu', 'ap', 'auto'].includes(config.region)) {
      issues.push(`Invalid CK_TELEMETRY_REGION value: ${config.region}. Must be one of: us, eu, ap, auto`);
    }

    // Check collector connectivity if using local mode
    if (config.tracesEndpoint.includes('localhost') || config.tracesEndpoint.includes('127.0.0.1')) {
      const isHealthy = await this.checkCollectorHealth();
      if (!isHealthy) {
        issues.push('Local collector not running or unreachable. Run: npm run otel:run');
      }
    }

    // Validate certificate if provided
    if (config.certificate) {
      try {
        Buffer.from(config.certificate, 'base64');
      } catch (error) {
        issues.push('Invalid OTEL_EXPORTER_OTLP_CERTIFICATE - must be base64 encoded');
      }
    }

    // Log validation results
    if (issues.length > 0) {
      logger.warn('⚠️  Telemetry Configuration Issues:', { issues });
    } else {
      logger.info('✅ Telemetry Configuration Valid', {
        serviceName: config.serviceName,
        environment: config.environment,
        tracesEndpoint: config.tracesEndpoint,
        metricsEndpoint: config.metricsEndpoint
      });
    }

    return {
      valid: issues.length === 0,
      issues
    };
  },

  /**
   * Check if collector is healthy
   */
  async checkCollectorHealth(): Promise<boolean> {
    try {
      const healthEndpoint = this.getCollectorHealthEndpoint();
      const response = await axios.get(healthEndpoint, {
        timeout: 5000,
        validateStatus: () => true
      });
      return response.status === 200;
    } catch (error) {
      logger.debug('Collector health check failed:', error);
      return false;
    }
  },

  /**
   * Get collector health endpoint
   */
  getCollectorHealthEndpoint(): string {
    const tracesUrl = process.env.OTLP_HTTP_TRACES_URL || 'http://localhost:4318/v1/traces';
    
    // Extract base URL from traces endpoint
    const url = new URL(tracesUrl);
    
    // Standard OpenTelemetry Collector health endpoint
    return `${url.protocol}//${url.hostname}:13133/health`;
  },

  /**
   * Get vendor-specific configuration
   */
  getVendorConfig(): { vendor: string; config: any } | null {
    const tracesEndpoint = process.env.OTLP_HTTP_TRACES_URL || '';
    
    if (tracesEndpoint.includes('datadog')) {
      return {
        vendor: 'datadog',
        config: {
          site: tracesEndpoint.includes('.eu') ? 'datadoghq.eu' : 'datadoghq.com',
          apiKey: process.env.DD_API_KEY,
          service: process.env.OTEL_SERVICE_NAME || 'cost-katana-api',
          env: process.env.NODE_ENV || 'development'
        }
      };
    }

    if (tracesEndpoint.includes('newrelic')) {
      return {
        vendor: 'newrelic',
        config: {
          accountId: process.env.NEW_RELIC_ACCOUNT_ID,
          apiKey: process.env.NEW_RELIC_API_KEY,
          region: tracesEndpoint.includes('.eu') ? 'eu' : 'us'
        }
      };
    }

    if (tracesEndpoint.includes('grafana')) {
      return {
        vendor: 'grafana',
        config: {
          instanceId: process.env.GRAFANA_INSTANCE_ID,
          apiKey: process.env.GRAFANA_API_KEY,
          zone: process.env.GRAFANA_ZONE || 'prod-us-central-0'
        }
      };
    }

    if (tracesEndpoint.includes('honeycomb')) {
      return {
        vendor: 'honeycomb',
        config: {
          apiKey: process.env.HONEYCOMB_API_KEY,
          dataset: process.env.HONEYCOMB_DATASET || 'cost-katana'
        }
      };
    }

    return null;
  },

  /**
   * Get telemetry status
   */
  async getStatus(): Promise<{
    enabled: boolean;
    configured: boolean;
    healthy: boolean;
    vendor?: string;
    issues?: string[];
  }> {
    const config = this.getConfig();
    
    if (!config.enabled) {
      return {
        enabled: false,
        configured: false,
        healthy: false
      };
    }

    const validation = await this.validate();
    const vendorConfig = this.getVendorConfig();
    const collectorHealthy = await this.checkCollectorHealth();

    return {
      enabled: config.enabled,
      configured: validation.valid,
      healthy: collectorHealthy || !config.tracesEndpoint.includes('localhost'),
      vendor: vendorConfig?.vendor,
      issues: validation.issues.length > 0 ? validation.issues : undefined
    };
  }
};

export default telemetryConfig;
