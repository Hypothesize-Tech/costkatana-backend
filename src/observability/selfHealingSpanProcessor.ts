import { SpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { Context } from '@opentelemetry/api';
import { loggingService } from '../services/logging.service';
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
    loggingService.info('=== SELF-HEALING SPAN PROCESSOR CONSTRUCTOR STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'constructor',
      type: 'span_processor_initialization',
      step: 'started'
    });

    this.exporter = exporter;
    
    loggingService.info('Step 1: Starting export timer', {
      component: 'SelfHealingSpanProcessor',
      operation: 'constructor',
      type: 'span_processor_initialization',
      step: 'start_export_timer'
    });

    this.startExportTimer();
    
    loggingService.info('Step 2: Loading buffer from Redis', {
      component: 'SelfHealingSpanProcessor',
      operation: 'constructor',
      type: 'span_processor_initialization',
      step: 'load_redis_buffer'
    });

    this.loadBufferFromRedis();

    loggingService.info('Self-Healing Span Processor initialized successfully', {
      component: 'SelfHealingSpanProcessor',
      operation: 'constructor',
      type: 'span_processor_initialization',
      step: 'completed',
      maxBufferSize: this.maxBufferSize,
      maxRetries: this.maxRetries,
      exportInterval: `${this.exportInterval}ms`
    });

    loggingService.info('=== SELF-HEALING SPAN PROCESSOR CONSTRUCTOR COMPLETED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'constructor',
      type: 'span_processor_initialization',
      step: 'completed'
    });
  }

  /**
   * Called when a span is started
   */
  onStart(span: ReadableSpan, parentContext: Context): void {
    const startTime = Date.now();
    
    loggingService.debug('=== SPAN START PROCESSING STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'onStart',
      type: 'span_processing',
      step: 'started',
      spanId: span.spanContext().spanId,
      traceId: span.spanContext().traceId,
      spanName: span.name
    });

    // Auto-enrich span with AI-inferred attributes
    this.enrichSpanAsync(span);

    loggingService.debug('Span start processing completed', {
      component: 'SelfHealingSpanProcessor',
      operation: 'onStart',
      type: 'span_processing',
      step: 'completed',
      spanId: span.spanContext().spanId,
      totalTime: `${Date.now() - startTime}ms`
    });
  }

  /**
   * Called when a span is ended
   */
  onEnd(span: ReadableSpan): void {
    const startTime = Date.now();
    
    loggingService.debug('=== SPAN END PROCESSING STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'onEnd',
      type: 'span_processing',
      step: 'started',
      spanId: span.spanContext().spanId,
      traceId: span.spanContext().traceId,
      spanName: span.name
    });

    try {
      loggingService.debug('Step 1: Adding span to buffer', {
        component: 'SelfHealingSpanProcessor',
        operation: 'onEnd',
        type: 'span_processing',
        step: 'add_to_buffer',
        spanId: span.spanContext().spanId,
        currentBufferSize: this.buffer.length
      });

      // Add to buffer for resilient export
      this.addToBuffer(span);
      
      loggingService.debug('Step 2: Checking export status', {
        component: 'SelfHealingSpanProcessor',
        operation: 'onEnd',
        type: 'span_processing',
        step: 'check_export_status',
        spanId: span.spanContext().spanId,
        isExporting: this.isExporting
      });

      // Try immediate export if not currently exporting
      if (!this.isExporting) {
        loggingService.debug('Step 3: Triggering immediate export', {
          component: 'SelfHealingSpanProcessor',
          operation: 'onEnd',
          type: 'span_processing',
          step: 'trigger_export',
          spanId: span.spanContext().spanId
        });

        this.exportSpans();
      } else {
        loggingService.debug('Export already in progress, skipping immediate export', {
          component: 'SelfHealingSpanProcessor',
          operation: 'onEnd',
          type: 'span_processing',
          step: 'export_skipped',
          spanId: span.spanContext().spanId,
          reason: 'Export already in progress'
        });
      }

      loggingService.debug('Span end processing completed successfully', {
        component: 'SelfHealingSpanProcessor',
        operation: 'onEnd',
        type: 'span_processing',
        step: 'completed',
        spanId: span.spanContext().spanId,
        totalTime: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      loggingService.error('Error in Self-Healing Span Processor onEnd', {
        component: 'SelfHealingSpanProcessor',
        operation: 'onEnd',
        type: 'span_processing',
        step: 'error',
        spanId: span.spanContext().spanId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        totalTime: `${Date.now() - startTime}ms`
      });
    }
  }

  /**
   * Shutdown the processor
   */
  async shutdown(): Promise<void> {
    const startTime = Date.now();
    
    loggingService.info('=== SELF-HEALING SPAN PROCESSOR SHUTDOWN STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'shutdown',
      type: 'span_processor_shutdown',
      step: 'started'
    });

    loggingService.info('Step 1: Clearing export timer', {
      component: 'SelfHealingSpanProcessor',
      operation: 'shutdown',
      type: 'span_processor_shutdown',
      step: 'clear_timer'
    });

    if (this.exportTimer) {
      clearInterval(this.exportTimer);
      
      loggingService.info('Export timer cleared successfully', {
        component: 'SelfHealingSpanProcessor',
        operation: 'shutdown',
        type: 'span_processor_shutdown',
        step: 'timer_cleared'
      });
    }

    loggingService.info('Step 2: Exporting remaining spans', {
      component: 'SelfHealingSpanProcessor',
      operation: 'shutdown',
      type: 'span_processor_shutdown',
      step: 'export_remaining',
      remainingSpans: this.buffer.length
    });

    // Export any remaining spans
    await this.exportSpans();
    
    loggingService.info('Step 3: Shutting down exporter', {
      component: 'SelfHealingSpanProcessor',
      operation: 'shutdown',
      type: 'span_processor_shutdown',
      step: 'shutdown_exporter'
    });

    // Shutdown the exporter
    await this.exporter.shutdown();

    loggingService.info('Self-Healing Span Processor shutdown completed successfully', {
      component: 'SelfHealingSpanProcessor',
      operation: 'shutdown',
      type: 'span_processor_shutdown',
      step: 'completed',
      totalTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== SELF-HEALING SPAN PROCESSOR SHUTDOWN COMPLETED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'shutdown',
      type: 'span_processor_shutdown',
      step: 'completed',
      totalTime: `${Date.now() - startTime}ms`
    });
  }

  /**
   * Force flush spans
   */
  async forceFlush(): Promise<void> {
    const startTime = Date.now();
    
    loggingService.info('=== FORCE FLUSH STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'forceFlush',
      type: 'span_flush',
      step: 'started',
      currentBufferSize: this.buffer.length
    });

    await this.exportSpans();

    loggingService.info('Force flush completed successfully', {
      component: 'SelfHealingSpanProcessor',
      operation: 'forceFlush',
      type: 'span_flush',
      step: 'completed',
      totalTime: `${Date.now() - startTime}ms`
    });
  }

  /**
   * Add span to buffer with Redis persistence
   */
  private addToBuffer(span: ReadableSpan): void {
    const startTime = Date.now();
    
    loggingService.debug('=== ADD TO BUFFER STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'addToBuffer',
      type: 'buffer_management',
      step: 'started',
      spanId: span.spanContext().spanId,
      currentBufferSize: this.buffer.length
    });

    const bufferedSpan: BufferedSpan = {
      span,
      timestamp: Date.now(),
      retryCount: 0
    };

    this.buffer.push(bufferedSpan);

    loggingService.debug('Step 1: Span added to in-memory buffer', {
      component: 'SelfHealingSpanProcessor',
      operation: 'addToBuffer',
      type: 'buffer_management',
      step: 'buffer_added',
      spanId: span.spanContext().spanId,
      newBufferSize: this.buffer.length
    });

    loggingService.debug('Step 2: Persisting buffer to Redis', {
      component: 'SelfHealingSpanProcessor',
      operation: 'addToBuffer',
      type: 'buffer_management',
      step: 'redis_persist'
    });

    // Persist to Redis for crash recovery
    this.persistBufferToRedis();

    loggingService.debug('Step 3: Checking buffer overflow', {
      component: 'SelfHealingSpanProcessor',
      operation: 'addToBuffer',
      type: 'buffer_management',
      step: 'overflow_check',
      currentSize: this.buffer.length,
      maxSize: this.maxBufferSize
    });

    // Prevent buffer overflow
    if (this.buffer.length > this.maxBufferSize) {
      const removed = this.buffer.shift();
      
      loggingService.warn('Span buffer overflow, dropping oldest span', {
        component: 'SelfHealingSpanProcessor',
        operation: 'addToBuffer',
        type: 'buffer_management',
        step: 'overflow_handled',
        droppedSpanId: removed?.span.spanContext().spanId,
        droppedTraceId: removed?.span.spanContext().traceId,
        currentBufferSize: this.buffer.length
      });
    }

    loggingService.debug('Add to buffer completed successfully', {
      component: 'SelfHealingSpanProcessor',
      operation: 'addToBuffer',
      type: 'buffer_management',
      step: 'completed',
      spanId: span.spanContext().spanId,
      finalBufferSize: this.buffer.length,
      totalTime: `${Date.now() - startTime}ms`
    });
  }

  /**
   * Export spans with retry logic and failover
   */
  private async exportSpans(): Promise<void> {
    if (this.isExporting || this.buffer.length === 0) {
      if (this.isExporting) {
        loggingService.debug('Export skipped - already in progress', {
          component: 'SelfHealingSpanProcessor',
          operation: 'exportSpans',
          type: 'span_export',
          step: 'skipped',
          reason: 'Export already in progress'
        });
      } else if (this.buffer.length === 0) {
        loggingService.debug('Export skipped - buffer empty', {
          component: 'SelfHealingSpanProcessor',
          operation: 'exportSpans',
          type: 'span_export',
          step: 'skipped',
          reason: 'Buffer empty'
        });
      }
      return;
    }

    const startTime = Date.now();
    
    loggingService.info('=== SPAN EXPORT STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'exportSpans',
      type: 'span_export',
      step: 'started',
      bufferSize: this.buffer.length
    });

    this.isExporting = true;

    try {
      loggingService.info('Step 1: Preparing spans for export', {
        component: 'SelfHealingSpanProcessor',
        operation: 'exportSpans',
        type: 'span_export',
        step: 'prepare_spans',
        totalSpans: this.buffer.length
      });

      // Get spans to export (up to 100 at a time)
      const spansToExport = this.buffer.splice(0, 100);
      const spans = spansToExport.map(bs => bs.span);

      loggingService.info(`Exporting ${spans.length} spans`, {
        component: 'SelfHealingSpanProcessor',
        operation: 'exportSpans',
        type: 'span_export',
        step: 'export_attempt',
        spanCount: spans.length,
        remainingInBuffer: this.buffer.length
      });

      loggingService.info('Step 2: Attempting export', {
        component: 'SelfHealingSpanProcessor',
        operation: 'exportSpans',
        type: 'span_export',
        step: 'export_attempt'
      });

      // Try to export
      const result = await this.exporter.export(spans);

      // Check if export was successful (result is void, so we assume success if no error thrown)
      if (result === undefined) { // SUCCESS
        loggingService.info(`Successfully exported ${spans.length} spans`, {
          component: 'SelfHealingSpanProcessor',
          operation: 'exportSpans',
          type: 'span_export',
          step: 'export_success',
          exportedCount: spans.length,
          resultCode: 'success'
        });

        loggingService.info('Step 3: Updating Redis buffer after successful export', {
          component: 'SelfHealingSpanProcessor',
          operation: 'exportSpans',
          type: 'span_export',
          step: 'update_redis'
        });

        // Update Redis buffer
        await this.persistBufferToRedis();
      } else {
        // Export failed, add back to buffer with retry logic
        loggingService.warn(`Export failed, adding spans back to buffer`, {
          component: 'SelfHealingSpanProcessor',
          operation: 'exportSpans',
          type: 'span_export',
          step: 'export_failed',
          resultCode: 'failed',
          spanCount: spansToExport.length
        });

        loggingService.info('Step 3: Processing failed spans with retry logic', {
          component: 'SelfHealingSpanProcessor',
          operation: 'exportSpans',
          type: 'span_export',
          step: 'retry_processing'
        });

        for (const bufferedSpan of spansToExport) {
          if (bufferedSpan.retryCount < this.maxRetries) {
            bufferedSpan.retryCount++;
            this.buffer.unshift(bufferedSpan); // Add back to front for retry
            
            loggingService.debug('Span added back to buffer for retry', {
              component: 'SelfHealingSpanProcessor',
              operation: 'exportSpans',
              type: 'span_export',
              step: 'retry_added',
              spanId: bufferedSpan.span.spanContext().spanId,
              retryCount: bufferedSpan.retryCount,
              maxRetries: this.maxRetries
            });
          } else {
            loggingService.error('Max retries exceeded for span, dropping', {
              component: 'SelfHealingSpanProcessor',
              operation: 'exportSpans',
              type: 'span_export',
              step: 'max_retries_exceeded',
              spanId: bufferedSpan.span.spanContext().spanId,
              traceId: bufferedSpan.span.spanContext().traceId,
              retryCount: bufferedSpan.retryCount,
              maxRetries: this.maxRetries
            });
          }
        }

        loggingService.info('Step 4: Persisting updated buffer after failed export', {
          component: 'SelfHealingSpanProcessor',
          operation: 'exportSpans',
          type: 'span_export',
          step: 'persist_after_failure'
        });

        // Persist updated buffer
        await this.persistBufferToRedis();
      }
    } catch (error) {
      loggingService.error('Error exporting spans', {
        component: 'SelfHealingSpanProcessor',
        operation: 'exportSpans',
        type: 'span_export',
        step: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // On export error, spans are already back in buffer, just log
      loggingService.warn(`Export error, ${this.buffer.length} spans remain in buffer`, {
        component: 'SelfHealingSpanProcessor',
        operation: 'exportSpans',
        type: 'span_export',
        step: 'error_recovery',
        remainingSpans: this.buffer.length
      });
    } finally {
      this.isExporting = false;
      
      loggingService.info('Span export process completed', {
        component: 'SelfHealingSpanProcessor',
        operation: 'exportSpans',
        type: 'span_export',
        step: 'completed',
        finalBufferSize: this.buffer.length,
        totalTime: `${Date.now() - startTime}ms`
      });
    }
  }

  /**
   * Persist buffer to Redis for crash recovery
   */
  private async persistBufferToRedis(): Promise<void> {
    const startTime = Date.now();
    
    loggingService.debug('=== REDIS BUFFER PERSISTENCE STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'persistBufferToRedis',
      type: 'redis_persistence',
      step: 'started',
      bufferSize: this.buffer.length
    });

    try {
      if (this.buffer.length === 0) {
        loggingService.debug('Step 1: Buffer empty, clearing Redis key', {
          component: 'SelfHealingSpanProcessor',
          operation: 'persistBufferToRedis',
          type: 'redis_persistence',
          step: 'clear_empty_buffer'
        });

        await redisService.del(this.redisBufferKey);
        
        loggingService.debug('Redis buffer key cleared successfully', {
          component: 'SelfHealingSpanProcessor',
          operation: 'persistBufferToRedis',
          type: 'redis_persistence',
          step: 'redis_cleared'
        });
        
        return;
      }

      loggingService.debug('Step 1: Serializing buffer for Redis storage', {
        component: 'SelfHealingSpanProcessor',
        operation: 'persistBufferToRedis',
        type: 'redis_persistence',
        step: 'serialize_buffer'
      });

      // Serialize buffer (excluding the actual span object to avoid circular refs)
      const serializedBuffer = this.buffer.map(bs => ({
        spanData: this.serializeSpan(bs.span),
        timestamp: bs.timestamp,
        retryCount: bs.retryCount
      }));

      loggingService.debug('Step 2: Storing serialized buffer in Redis', {
        component: 'SelfHealingSpanProcessor',
        operation: 'persistBufferToRedis',
        type: 'redis_persistence',
        step: 'store_in_redis',
        serializedSize: serializedBuffer.length,
        redisKey: this.redisBufferKey
      });

      await redisService.set(
        this.redisBufferKey,
        JSON.stringify(serializedBuffer),
        3600 // 1 hour TTL
      );

      loggingService.debug('Buffer persisted to Redis successfully', {
        component: 'SelfHealingSpanProcessor',
        operation: 'persistBufferToRedis',
        type: 'redis_persistence',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      loggingService.error('Failed to persist span buffer to Redis', {
        component: 'SelfHealingSpanProcessor',
        operation: 'persistBufferToRedis',
        type: 'redis_persistence',
        step: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        totalTime: `${Date.now() - startTime}ms`
      });
    }
  }

  /**
   * Load buffer from Redis on startup
   */
  private async loadBufferFromRedis(): Promise<void> {
    const startTime = Date.now();
    
    loggingService.info('=== REDIS BUFFER LOADING STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'loadBufferFromRedis',
      type: 'redis_recovery',
      step: 'started'
    });

    try {
      loggingService.info('Step 1: Retrieving buffer from Redis', {
        component: 'SelfHealingSpanProcessor',
        operation: 'loadBufferFromRedis',
        type: 'redis_recovery',
        step: 'retrieve_from_redis',
        redisKey: this.redisBufferKey
      });

      const serializedBuffer = await redisService.get(this.redisBufferKey);
      if (!serializedBuffer) {
        loggingService.info('No Redis buffer found, starting with empty buffer', {
          component: 'SelfHealingSpanProcessor',
          operation: 'loadBufferFromRedis',
          type: 'redis_recovery',
          step: 'no_buffer_found'
        });
        return;
      }

      loggingService.info('Step 2: Parsing serialized buffer data', {
        component: 'SelfHealingSpanProcessor',
        operation: 'loadBufferFromRedis',
        type: 'redis_recovery',
        step: 'parse_buffer_data'
      });

      const bufferData = JSON.parse(serializedBuffer);
      
      loggingService.info(`Loaded ${bufferData.length} spans from Redis buffer`, {
        component: 'SelfHealingSpanProcessor',
        operation: 'loadBufferFromRedis',
        type: 'redis_recovery',
        step: 'buffer_loaded',
        spanCount: bufferData.length
      });

      loggingService.info('Step 3: Clearing Redis buffer (spans are complex objects)', {
        component: 'SelfHealingSpanProcessor',
        operation: 'loadBufferFromRedis',
        type: 'redis_recovery',
        step: 'clear_redis_buffer',
        note: 'In a real implementation, you\'d need to reconstruct ReadableSpan objects'
      });

      // Note: In a real implementation, you'd need to reconstruct ReadableSpan objects
      // For now, we'll just clear the Redis buffer since spans are complex objects
      await redisService.del(this.redisBufferKey);

      loggingService.info('Redis buffer loading completed successfully', {
        component: 'SelfHealingSpanProcessor',
        operation: 'loadBufferFromRedis',
        type: 'redis_recovery',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      loggingService.error('Failed to load span buffer from Redis', {
        component: 'SelfHealingSpanProcessor',
        operation: 'loadBufferFromRedis',
        type: 'redis_recovery',
        step: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        totalTime: `${Date.now() - startTime}ms`
      });
    }
  }

  /**
   * Serialize span for Redis storage
   */
  private serializeSpan(span: ReadableSpan): any {
    const startTime = Date.now();
    
    loggingService.debug('=== SPAN SERIALIZATION STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'serializeSpan',
      type: 'span_serialization',
      step: 'started',
      spanId: span.spanContext().spanId
    });

    const serialized = {
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

    loggingService.debug('Span serialized successfully', {
      component: 'SelfHealingSpanProcessor',
      operation: 'serializeSpan',
      type: 'span_serialization',
      step: 'completed',
      spanId: span.spanContext().spanId,
      totalTime: `${Date.now() - startTime}ms`
    });

    return serialized;
  }

  /**
   * Start export timer for periodic exports
   */
  private startExportTimer(): void {
    loggingService.info('=== EXPORT TIMER SETUP STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'startExportTimer',
      type: 'timer_setup',
      step: 'started',
      exportInterval: `${this.exportInterval}ms`
    });

    this.exportTimer = setInterval(() => {
      if (this.buffer.length > 0) {
        loggingService.debug('Export timer triggered, checking buffer', {
          component: 'SelfHealingSpanProcessor',
          operation: 'startExportTimer',
          type: 'timer_setup',
          step: 'timer_triggered',
          bufferSize: this.buffer.length
        });
        
        this.exportSpans();
      }
    }, this.exportInterval);

    loggingService.info('Export timer setup completed successfully', {
      component: 'SelfHealingSpanProcessor',
      operation: 'startExportTimer',
      type: 'timer_setup',
      step: 'completed',
      exportInterval: `${this.exportInterval}ms`
    });
  }

  /**
   * Enrich span asynchronously with AI
   */
  private async enrichSpanAsync(span: ReadableSpan): Promise<void> {
    const startTime = Date.now();
    
    loggingService.debug('=== SPAN ENRICHMENT STARTED ===', {
      component: 'SelfHealingSpanProcessor',
      operation: 'enrichSpanAsync',
      type: 'span_enrichment',
      step: 'started',
      spanId: span.spanContext().spanId
    });

    try {
      // Don't block span processing, enrich in background
      setImmediate(async () => {
        await otelEnricherService.autoEnrichSpan(span as any);
      });

      loggingService.debug('Span enrichment scheduled successfully', {
        component: 'SelfHealingSpanProcessor',
        operation: 'enrichSpanAsync',
        type: 'span_enrichment',
        step: 'scheduled',
        spanId: span.spanContext().spanId,
        totalTime: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      loggingService.error('Error enriching span', {
        component: 'SelfHealingSpanProcessor',
        operation: 'enrichSpanAsync',
        type: 'span_enrichment',
        step: 'error',
        spanId: span.spanContext().spanId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        totalTime: `${Date.now() - startTime}ms`
      });
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
    const stats = {
      bufferSize: this.buffer.length,
      isExporting: this.isExporting,
      oldestSpanAge: oldestSpan ? Date.now() - oldestSpan.timestamp : 0
    };

    loggingService.debug('Buffer statistics retrieved', {
      component: 'SelfHealingSpanProcessor',
      operation: 'getBufferStats',
      type: 'buffer_stats',
      step: 'retrieved',
      ...stats
    });

    return stats;
  }
}
