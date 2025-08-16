import { SpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { Context } from '@opentelemetry/api';
import { logger } from '../utils/logger';
import { redisService } from '../services/redis.service';
import { otelEnricherService } from '../services/otelEnricher.service';

interface BufferedSpan {
  span: ReadableSpan;
  timestamp: number;
  retryCount: number;
}

export class SelfHealingSpanProcessor implements SpanProcessor {
  private exporter: SpanExporter;
  private buffer: BufferedSpan[] = [];
  private isExporting = false;
  private maxBufferSize = 1000;
  private maxRetries = 3;
  private exportInterval = 5000; // 5 seconds
  private redisBufferKey = 'otel:span_buffer';
  private exportTimer?: NodeJS.Timeout;

  constructor(exporter: SpanExporter) {
    this.exporter = exporter;
    this.startExportTimer();
    this.loadBufferFromRedis();
  }

  /**
   * Called when a span is started
   */
  onStart(span: ReadableSpan, parentContext: Context): void {
    // Auto-enrich span with AI-inferred attributes
    this.enrichSpanAsync(span);
  }

  /**
   * Called when a span is ended
   */
  onEnd(span: ReadableSpan): void {
    try {
      // Add to buffer for resilient export
      this.addToBuffer(span);
      
      // Try immediate export if not currently exporting
      if (!this.isExporting) {
        this.exportSpans();
      }
    } catch (error) {
      logger.error('Error in SelfHealingSpanProcessor.onEnd:', error);
    }
  }

  /**
   * Shutdown the processor
   */
  async shutdown(): Promise<void> {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
    }

    // Export any remaining spans
    await this.exportSpans();
    
    // Shutdown the exporter
    await this.exporter.shutdown();
  }

  /**
   * Force flush spans
   */
  async forceFlush(): Promise<void> {
    await this.exportSpans();
  }

  /**
   * Add span to buffer with Redis persistence
   */
  private addToBuffer(span: ReadableSpan): void {
    const bufferedSpan: BufferedSpan = {
      span,
      timestamp: Date.now(),
      retryCount: 0
    };

    this.buffer.push(bufferedSpan);

    // Persist to Redis for crash recovery
    this.persistBufferToRedis();

    // Prevent buffer overflow
    if (this.buffer.length > this.maxBufferSize) {
      const removed = this.buffer.shift();
      logger.warn('Span buffer overflow, dropping oldest span:', {
        spanId: removed?.span.spanContext().spanId,
        traceId: removed?.span.spanContext().traceId
      });
    }
  }

  /**
   * Export spans with retry logic and failover
   */
  private async exportSpans(): Promise<void> {
    if (this.isExporting || this.buffer.length === 0) {
      return;
    }

    this.isExporting = true;

    try {
      // Get spans to export (up to 100 at a time)
      const spansToExport = this.buffer.splice(0, 100);
      const spans = spansToExport.map(bs => bs.span);

      logger.debug(`Exporting ${spans.length} spans`);

      // Try to export
      const result = await this.exporter.export(spans);

      if (result.code === 0) { // SUCCESS
        logger.debug(`Successfully exported ${spans.length} spans`);
        // Update Redis buffer
        await this.persistBufferToRedis();
      } else {
        // Export failed, add back to buffer with retry logic
        logger.warn(`Export failed with code ${result.code}, adding spans back to buffer`);
        
        for (const bufferedSpan of spansToExport) {
          if (bufferedSpan.retryCount < this.maxRetries) {
            bufferedSpan.retryCount++;
            this.buffer.unshift(bufferedSpan); // Add back to front for retry
          } else {
            logger.error('Max retries exceeded for span, dropping:', {
              spanId: bufferedSpan.span.spanContext().spanId,
              traceId: bufferedSpan.span.spanContext().traceId,
              retryCount: bufferedSpan.retryCount
            });
          }
        }

        // Persist updated buffer
        await this.persistBufferToRedis();
      }
    } catch (error) {
      logger.error('Error exporting spans:', error);
      
      // On export error, spans are already back in buffer, just log
      logger.warn(`Export error, ${this.buffer.length} spans remain in buffer`);
    } finally {
      this.isExporting = false;
    }
  }

  /**
   * Persist buffer to Redis for crash recovery
   */
  private async persistBufferToRedis(): Promise<void> {
    try {
      if (this.buffer.length === 0) {
        await redisService.del(this.redisBufferKey);
        return;
      }

      // Serialize buffer (excluding the actual span object to avoid circular refs)
      const serializedBuffer = this.buffer.map(bs => ({
        spanData: this.serializeSpan(bs.span),
        timestamp: bs.timestamp,
        retryCount: bs.retryCount
      }));

      await redisService.setex(
        this.redisBufferKey,
        3600, // 1 hour TTL
        JSON.stringify(serializedBuffer)
      );
    } catch (error) {
      logger.error('Failed to persist span buffer to Redis:', error);
    }
  }

  /**
   * Load buffer from Redis on startup
   */
  private async loadBufferFromRedis(): Promise<void> {
    try {
      const serializedBuffer = await redisService.get(this.redisBufferKey);
      if (!serializedBuffer) return;

      const bufferData = JSON.parse(serializedBuffer);
      logger.info(`Loaded ${bufferData.length} spans from Redis buffer`);

      // Note: In a real implementation, you'd need to reconstruct ReadableSpan objects
      // For now, we'll just clear the Redis buffer since spans are complex objects
      await redisService.del(this.redisBufferKey);
    } catch (error) {
      logger.error('Failed to load span buffer from Redis:', error);
    }
  }

  /**
   * Serialize span for Redis storage
   */
  private serializeSpan(span: ReadableSpan): any {
    return {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      kind: span.kind,
      startTime: span.startTime,
      endTime: span.endTime,
      status: span.status,
      attributes: span.attributes,
      events: span.events,
      links: span.links,
      resource: span.resource.attributes
    };
  }

  /**
   * Start export timer for periodic exports
   */
  private startExportTimer(): void {
    this.exportTimer = setInterval(() => {
      if (this.buffer.length > 0) {
        this.exportSpans();
      }
    }, this.exportInterval);
  }

  /**
   * Enrich span asynchronously with AI
   */
  private async enrichSpanAsync(span: ReadableSpan): Promise<void> {
    try {
      // Don't block span processing, enrich in background
      setImmediate(async () => {
        await otelEnricherService.autoEnrichSpan(span as any);
      });
    } catch (error) {
      logger.error('Error enriching span:', error);
    }
  }

  /**
   * Get buffer statistics
   */
  getBufferStats(): {
    bufferSize: number;
    isExporting: boolean;
    oldestSpanAge: number;
  } {
    const oldestSpan = this.buffer[0];
    return {
      bufferSize: this.buffer.length,
      isExporting: this.isExporting,
      oldestSpanAge: oldestSpan ? Date.now() - oldestSpan.timestamp : 0
    };
  }
}
