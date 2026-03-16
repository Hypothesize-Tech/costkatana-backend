import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';

export interface DataFlow {
  flowId: string;
  requestId: string;
  userId: string;
  startTime: number;
  lastActivity: number;
  status: 'active' | 'completed' | 'failed' | 'blocked';
  checkpoints: Array<{
    checkpointId: string;
    component: string;
    action: string;
    timestamp: number;
    metadata?: Record<string, any>;
  }>;
  metrics: {
    processingTime: number;
    dataSize: number;
    riskScore: number;
    components: string[];
  };
  alerts: Array<{
    alertId: string;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    timestamp: number;
    resolved?: boolean;
  }>;
}

export interface MonitoringConfig {
  enableRealTimeTracking: boolean;
  maxConcurrentFlows: number;
  flowTimeout: number; // ms
  checkpointInterval: number; // ms
  alertThresholds: {
    processingTime: number;
    riskScore: number;
    dataSize: number;
  };
  retentionPeriod: number; // ms
}

@Injectable()
export class RealTimeMonitoringService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealTimeMonitoringService.name);
  private readonly activeFlows = new Map<string, DataFlow>();
  private readonly flowTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly eventEmitter = new EventEmitter();
  private readonly config: MonitoringConfig = {
    enableRealTimeTracking: true,
    maxConcurrentFlows: 1000,
    flowTimeout: 300000, // 5 minutes
    checkpointInterval: 30000, // 30 seconds
    alertThresholds: {
      processingTime: 60000, // 1 minute
      riskScore: 0.8,
      dataSize: 10000000, // 10MB
    },
    retentionPeriod: 3600000, // 1 hour
  };

  constructor() {
    this.eventEmitter.setMaxListeners(50);
  }

  onModuleInit() {
    this.logger.log('Real-time monitoring service initialized');
    this.startCleanupInterval();
  }

  onModuleDestroy() {
    this.logger.log('Real-time monitoring service shutting down');
    this.cleanup();
  }

  async startDataFlow(
    requestId: string,
    userId: string,
    initialMetadata?: Record<string, any>,
  ): Promise<string> {
    if (!this.config.enableRealTimeTracking) {
      return `disabled_${Date.now()}`;
    }

    const flowId = this.generateFlowId();
    const now = Date.now();

    const dataFlow: DataFlow = {
      flowId,
      requestId,
      userId,
      startTime: now,
      lastActivity: now,
      status: 'active',
      checkpoints: [
        {
          checkpointId: this.generateCheckpointId(),
          component: 'monitoring',
          action: 'flow_started',
          timestamp: now,
          metadata: initialMetadata,
        },
      ],
      metrics: {
        processingTime: 0,
        dataSize: 0,
        riskScore: 0,
        components: ['monitoring'],
      },
      alerts: [],
    };

    this.activeFlows.set(flowId, dataFlow);

    // Set timeout for flow
    const timeout = setTimeout(() => {
      this.handleFlowTimeout(flowId);
    }, this.config.flowTimeout);

    this.flowTimeouts.set(flowId, timeout);

    // Check concurrent flow limits
    if (this.activeFlows.size > this.config.maxConcurrentFlows) {
      this.logger.warn('Maximum concurrent flows exceeded', {
        currentFlows: this.activeFlows.size,
        maxFlows: this.config.maxConcurrentFlows,
      });
    }

    this.logger.debug('Data flow started', { flowId, requestId, userId });

    return flowId;
  }

  async addCheckpoint(
    flowId: string,
    component: string,
    action: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const flow = this.activeFlows.get(flowId);
    if (!flow) {
      this.logger.warn('Checkpoint added to non-existent flow', {
        flowId,
        component,
        action,
      });
      return;
    }

    const now = Date.now();
    const checkpoint = {
      checkpointId: this.generateCheckpointId(),
      component,
      action,
      timestamp: now,
      metadata,
    };

    flow.checkpoints.push(checkpoint);
    flow.lastActivity = now;

    // Update metrics
    flow.metrics.processingTime = now - flow.startTime;
    flow.metrics.components = [
      ...new Set([...flow.metrics.components, component]),
    ];

    // Update data size if provided
    if (metadata?.dataSize) {
      flow.metrics.dataSize = Math.max(
        flow.metrics.dataSize,
        metadata.dataSize,
      );
    }

    // Update risk score if provided
    if (metadata?.riskScore !== undefined) {
      flow.metrics.riskScore = Math.max(
        flow.metrics.riskScore,
        metadata.riskScore,
      );
    }

    // Check for alerts
    this.checkThresholdAlerts(flow);

    // Extend timeout
    this.extendFlowTimeout(flowId);

    this.eventEmitter.emit('checkpoint', { flowId, checkpoint });
  }

  async completeDataFlow(
    flowId: string,
    finalStatus: 'completed' | 'failed' | 'blocked' = 'completed',
  ): Promise<void> {
    const flow = this.activeFlows.get(flowId);
    if (!flow) {
      this.logger.warn('Attempted to complete non-existent flow', { flowId });
      return;
    }

    const now = Date.now();
    flow.status = finalStatus;
    flow.metrics.processingTime = now - flow.startTime;

    // Clear timeout
    const timeout = this.flowTimeouts.get(flowId);
    if (timeout) {
      clearTimeout(timeout);
      this.flowTimeouts.delete(flowId);
    }

    // Add final checkpoint
    await this.addCheckpoint(flowId, 'monitoring', `flow_${finalStatus}`);

    this.logger.debug('Data flow completed', {
      flowId,
      status: finalStatus,
      processingTime: flow.metrics.processingTime,
      checkpoints: flow.checkpoints.length,
      alerts: flow.alerts.length,
    });

    this.eventEmitter.emit('flowCompleted', { flowId, flow });

    // Schedule cleanup (keep for retention period)
    setTimeout(() => {
      this.activeFlows.delete(flowId);
    }, this.config.retentionPeriod);
  }

  getDataFlow(flowId: string): DataFlow | null {
    return this.activeFlows.get(flowId) || null;
  }

  getActiveFlows(): DataFlow[] {
    return Array.from(this.activeFlows.values());
  }

  getFlowMetrics(): {
    totalActiveFlows: number;
    averageProcessingTime: number;
    totalAlerts: number;
    componentUsage: Record<string, number>;
    riskDistribution: Record<string, number>;
  } {
    const flows = Array.from(this.activeFlows.values());
    const componentUsage: Record<string, number> = {};
    const riskDistribution: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    let totalProcessingTime = 0;
    let totalAlerts = 0;

    for (const flow of flows) {
      totalProcessingTime += flow.metrics.processingTime;
      totalAlerts += flow.alerts.length;

      for (const component of flow.metrics.components) {
        componentUsage[component] = (componentUsage[component] || 0) + 1;
      }

      if (flow.metrics.riskScore < 0.3) riskDistribution.low++;
      else if (flow.metrics.riskScore < 0.6) riskDistribution.medium++;
      else if (flow.metrics.riskScore < 0.8) riskDistribution.high++;
      else riskDistribution.critical++;
    }

    return {
      totalActiveFlows: flows.length,
      averageProcessingTime:
        flows.length > 0 ? totalProcessingTime / flows.length : 0,
      totalAlerts,
      componentUsage,
      riskDistribution,
    };
  }

  addAlert(
    flowId: string,
    type: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    message: string,
  ): void {
    const flow = this.activeFlows.get(flowId);
    if (!flow) return;

    const alert = {
      alertId: this.generateAlertId(),
      type,
      severity,
      message,
      timestamp: Date.now(),
      resolved: false,
    };

    flow.alerts.push(alert);

    this.logger.warn('Alert generated', {
      flowId,
      alertId: alert.alertId,
      type,
      severity,
      message,
    });

    this.eventEmitter.emit('alert', { flowId, alert });
  }

  resolveAlert(flowId: string, alertId: string): boolean {
    const flow = this.activeFlows.get(flowId);
    if (!flow) return false;

    const alert = flow.alerts.find((a) => a.alertId === alertId);
    if (!alert) return false;

    alert.resolved = true;
    this.eventEmitter.emit('alertResolved', { flowId, alertId });
    return true;
  }

  // Event listener methods
  onCheckpoint(
    listener: (data: { flowId: string; checkpoint: any }) => void,
  ): void {
    this.eventEmitter.on('checkpoint', listener);
  }

  onFlowCompleted(
    listener: (data: { flowId: string; flow: DataFlow }) => void,
  ): void {
    this.eventEmitter.on('flowCompleted', listener);
  }

  onAlert(listener: (data: { flowId: string; alert: any }) => void): void {
    this.eventEmitter.on('alert', listener);
  }

  onAlertResolved(
    listener: (data: { flowId: string; alertId: string }) => void,
  ): void {
    this.eventEmitter.on('alertResolved', listener);
  }

  removeAllListeners(): void {
    this.eventEmitter.removeAllListeners();
  }

  private checkThresholdAlerts(flow: DataFlow): void {
    const metrics = flow.metrics;

    // Processing time alert
    if (metrics.processingTime > this.config.alertThresholds.processingTime) {
      this.addAlert(
        flow.flowId,
        'processing_time_exceeded',
        'medium',
        `Processing time ${metrics.processingTime}ms exceeds threshold ${this.config.alertThresholds.processingTime}ms`,
      );
    }

    // Risk score alert
    if (metrics.riskScore > this.config.alertThresholds.riskScore) {
      this.addAlert(
        flow.flowId,
        'high_risk_score',
        'high',
        `Risk score ${metrics.riskScore} exceeds threshold ${this.config.alertThresholds.riskScore}`,
      );
    }

    // Data size alert
    if (metrics.dataSize > this.config.alertThresholds.dataSize) {
      this.addAlert(
        flow.flowId,
        'large_data_size',
        'medium',
        `Data size ${metrics.dataSize} bytes exceeds threshold ${this.config.alertThresholds.dataSize} bytes`,
      );
    }
  }

  private handleFlowTimeout(flowId: string): void {
    this.logger.warn('Data flow timed out', { flowId });
    this.completeDataFlow(flowId, 'failed');
  }

  private extendFlowTimeout(flowId: string): void {
    const existingTimeout = this.flowTimeouts.get(flowId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      this.handleFlowTimeout(flowId);
    }, this.config.flowTimeout);

    this.flowTimeouts.set(flowId, timeout);
  }

  private startCleanupInterval(): void {
    setInterval(() => {
      this.cleanupExpiredFlows();
    }, this.config.checkpointInterval);
  }

  private cleanupExpiredFlows(): void {
    const now = Date.now();
    const expiredFlows: string[] = [];

    for (const [flowId, flow] of this.activeFlows.entries()) {
      const timeSinceLastActivity = now - flow.lastActivity;
      if (timeSinceLastActivity > this.config.flowTimeout) {
        expiredFlows.push(flowId);
      }
    }

    for (const flowId of expiredFlows) {
      this.logger.warn('Cleaning up expired flow', { flowId });
      this.completeDataFlow(flowId, 'failed');
    }
  }

  private cleanup(): void {
    // Clear all timeouts
    for (const timeout of this.flowTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.flowTimeouts.clear();

    // Complete all active flows
    for (const [flowId] of this.activeFlows) {
      this.completeDataFlow(flowId, 'failed');
    }

    this.eventEmitter.removeAllListeners();
  }

  private generateFlowId(): string {
    return `flow_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateCheckpointId(): string {
    return `chk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }
}
