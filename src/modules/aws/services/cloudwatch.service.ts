import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  CloudWatchClient,
  GetMetricDataCommand,
  GetMetricStatisticsCommand,
  DescribeAlarmsCommand,
  ListMetricsCommand,
  GetDashboardCommand,
  ListDashboardsCommand,
} from '@aws-sdk/client-cloudwatch';
import { StsCredentialService } from './sts-credential.service';
import { PermissionBoundaryService } from './permission-boundary.service';

/**
 * CloudWatch Service Provider - CloudWatch Operations
 *
 * Allowed Operations:
 * - Read-only: GetMetricData, DescribeAlarms, GetDashboard, ListMetrics
 * - No write operations allowed
 */

export interface MetricDataPoint {
  timestamp: Date;
  value: number;
}

export interface MetricResult {
  id: string;
  label: string;
  dataPoints: MetricDataPoint[];
}

export interface CloudWatchAlarm {
  alarmName: string;
  alarmArn: string;
  stateValue: string;
  metricName: string;
  namespace: string;
  threshold: number;
  comparisonOperator: string;
}

export interface CloudWatchMetric {
  namespace: string;
  metricName: string;
  dimensions: Array<{ name: string; value: string }>;
}

@Injectable()
export class CloudWatchService {
  constructor(
    private readonly logger: LoggerService,
    private readonly stsCredentialService: StsCredentialService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
  ) {}

  private async getClient(
    connection: any,
    region?: string,
  ): Promise<CloudWatchClient> {
    const credentials = await this.stsCredentialService.assumeRole(connection);

    return new CloudWatchClient({
      region: region || connection.allowedRegions?.[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }

  /**
   * Get metric data
   */
  async getMetricData(
    connection: any,
    queries: Array<{
      id: string;
      namespace: string;
      metricName: string;
      dimensions?: Array<{ Name: string; Value: string }>;
      stat: string;
      period: number;
    }>,
    startTime: Date,
    endTime: Date,
    region?: string,
  ): Promise<MetricResult[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'GetMetricData', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new GetMetricDataCommand({
      MetricDataQueries: queries.map((q) => ({
        Id: q.id,
        MetricStat: {
          Metric: {
            Namespace: q.namespace,
            MetricName: q.metricName,
            Dimensions: q.dimensions,
          },
          Stat: q.stat,
          Period: q.period,
        },
      })),
      StartTime: startTime,
      EndTime: endTime,
    });

    const response = await client.send(command);

    const results: MetricResult[] = [];

    for (const result of response.MetricDataResults || []) {
      const dataPoints: MetricDataPoint[] = [];

      const timestamps = result.Timestamps || [];
      const values = result.Values || [];

      for (let i = 0; i < timestamps.length; i++) {
        dataPoints.push({
          timestamp: timestamps[i],
          value: values[i],
        });
      }

      results.push({
        id: result.Id || '',
        label: result.Label || '',
        dataPoints,
      });
    }

    this.logger.log('CloudWatch metrics retrieved', {
      component: 'CloudWatchService',
      operation: 'getMetricData',
      connectionId: connection._id.toString(),
      queryCount: queries.length,
      resultCount: results.length,
      region,
    });

    return results;
  }

  /**
   * Put metric data into CloudWatch.
   * NOTE: Actual write operations are not allowed by the current permission boundary.
   * This method emulates a successful put for API compatibility, but logs an informative message.
   *
   * @param _namespace - The metric namespace
   * @param _metrics - Array of metrics to put
   * @returns Resolves immediately (no-op)
   */
  async putMetricData(
    _namespace: string,
    _metrics: Array<{
      MetricName: string;
      Value: number;
      Unit: string;
      Dimensions?: Array<{ Name: string; Value: string }>;
    }>,
  ): Promise<void> {
    this.logger.warn(
      'Attempted to put metric data, but CloudWatch write operations are not allowed.',
      {
        component: 'CloudWatchService',
        operation: 'putMetricData',
        namespace: _namespace,
        metricCount: _metrics?.length ?? 0,
      },
    );
    // Intentionally no-op: Write not permitted per permission boundary.
    return;
  }

  /**
   * Get EC2 CPU utilization
   */
  async getEC2CPUUtilization(
    connection: any,
    instanceIds: string[],
    startTime: Date,
    endTime: Date,
    region?: string,
  ): Promise<MetricResult[]> {
    const queries = instanceIds.map((instanceId, index) => ({
      id: `cpu${index}`,
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      dimensions: [{ Name: 'InstanceId', Value: instanceId }],
      stat: 'Average',
      period: 300, // 5 minutes
    }));

    return this.getMetricData(connection, queries, startTime, endTime, region);
  }

  /**
   * Get RDS CPU utilization
   */
  async getRDSCPUUtilization(
    connection: any,
    dbInstanceIdentifiers: string[],
    startTime: Date,
    endTime: Date,
    region?: string,
  ): Promise<MetricResult[]> {
    const queries = dbInstanceIdentifiers.map((dbIdentifier, index) => ({
      id: `cpu${index}`,
      namespace: 'AWS/RDS',
      metricName: 'CPUUtilization',
      dimensions: [{ Name: 'DBInstanceIdentifier', Value: dbIdentifier }],
      stat: 'Average',
      period: 300,
    }));

    return this.getMetricData(connection, queries, startTime, endTime, region);
  }

  /**
   * Get Lambda metrics
   */
  async getLambdaMetrics(
    connection: any,
    functionNames: string[],
    startTime: Date,
    endTime: Date,
    region?: string,
  ): Promise<MetricResult[]> {
    const queries: Array<{
      id: string;
      namespace: string;
      metricName: string;
      dimensions?: Array<{ Name: string; Value: string }>;
      stat: string;
      period: number;
    }> = [];

    functionNames.forEach((functionName, index) => {
      queries.push({
        id: `duration${index}`,
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        dimensions: [{ Name: 'FunctionName', Value: functionName }],
        stat: 'Average',
        period: 300,
      });

      queries.push({
        id: `errors${index}`,
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensions: [{ Name: 'FunctionName', Value: functionName }],
        stat: 'Sum',
        period: 300,
      });

      queries.push({
        id: `invocations${index}`,
        namespace: 'AWS/Lambda',
        metricName: 'Invocations',
        dimensions: [{ Name: 'FunctionName', Value: functionName }],
        stat: 'Sum',
        period: 300,
      });
    });

    return this.getMetricData(connection, queries, startTime, endTime, region);
  }

  /**
   * List alarms
   */
  async listAlarms(
    connection: any,
    alarmNamePrefix?: string,
    stateValue?: string,
    region?: string,
  ): Promise<CloudWatchAlarm[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'DescribeAlarms', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new DescribeAlarmsCommand({
      AlarmNamePrefix: alarmNamePrefix,
      StateValue: stateValue as any,
    });

    const response = await client.send(command);

    const alarms: CloudWatchAlarm[] = [];

    for (const alarm of response.MetricAlarms || []) {
      alarms.push({
        alarmName: alarm.AlarmName || '',
        alarmArn: alarm.AlarmArn || '',
        stateValue: alarm.StateValue || '',
        metricName: alarm.MetricName || '',
        namespace: alarm.Namespace || '',
        threshold: alarm.Threshold || 0,
        comparisonOperator: alarm.ComparisonOperator || '',
      });
    }

    this.logger.log('CloudWatch alarms listed', {
      component: 'CloudWatchService',
      operation: 'listAlarms',
      connectionId: connection._id.toString(),
      alarmCount: alarms.length,
      region,
    });

    return alarms;
  }

  /**
   * List metrics
   */
  async listMetrics(
    connection: any,
    namespace?: string,
    metricName?: string,
    dimensions?: Array<{ Name: string; Value: string }>,
    region?: string,
  ): Promise<CloudWatchMetric[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'ListMetrics', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new ListMetricsCommand({
      Namespace: namespace,
      MetricName: metricName,
      Dimensions: dimensions,
    });

    const response = await client.send(command);

    const metrics: CloudWatchMetric[] = [];

    for (const metric of response.Metrics || []) {
      metrics.push({
        namespace: metric.Namespace || '',
        metricName: metric.MetricName || '',
        dimensions: (metric.Dimensions || []).map((d) => ({
          name: d.Name || '',
          value: d.Value || '',
        })),
      });
    }

    this.logger.log('CloudWatch metrics listed', {
      component: 'CloudWatchService',
      operation: 'listMetrics',
      connectionId: connection._id.toString(),
      metricCount: metrics.length,
      namespace,
      region,
    });

    return metrics;
  }

  /**
   * Get dashboard
   */
  async getDashboard(
    connection: any,
    dashboardName: string,
    region?: string,
  ): Promise<string> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'GetDashboard', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new GetDashboardCommand({
      DashboardName: dashboardName,
    });

    const response = await client.send(command);

    this.logger.log('CloudWatch dashboard retrieved', {
      component: 'CloudWatchService',
      operation: 'getDashboard',
      connectionId: connection._id.toString(),
      dashboardName,
      region,
    });

    return response.DashboardBody || '';
  }

  /**
   * List dashboards
   */
  async listDashboards(connection: any, region?: string): Promise<string[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'ListDashboards', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new ListDashboardsCommand({});

    const response = await client.send(command);

    const dashboardNames = (response.DashboardEntries || []).map(
      (d) => d.DashboardName || '',
    );

    this.logger.log('CloudWatch dashboards listed', {
      component: 'CloudWatchService',
      operation: 'listDashboards',
      connectionId: connection._id.toString(),
      dashboardCount: dashboardNames.length,
      region,
    });

    return dashboardNames;
  }

  /**
   * Find idle EC2 instances based on CPU utilization
   *
   * Analyzes CloudWatch CPU metrics to identify instances with low utilization.
   *
   * @param connection - AWS connection document
   * @param instanceIds - Array of EC2 instance IDs to analyze
   * @param cpuThreshold - CPU utilization threshold percentage (default: 5%)
   * @param days - Number of days to look back for metrics (default: 7)
   * @param region - AWS region
   * @returns Array of idle instance IDs with their average CPU utilization
   */
  async findIdleEC2Instances(
    connection: any,
    instanceIds: string[],
    cpuThreshold: number = 5,
    days: number = 7,
    region?: string,
  ): Promise<Array<{ instanceId: string; averageCpuUtilization: number }>> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'GetMetricStatistics', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

    const client = await this.getClient(connection, region);

    const idleInstances: Array<{
      instanceId: string;
      averageCpuUtilization: number;
    }> = [];

    for (const instanceId of instanceIds) {
      try {
        const command = new GetMetricStatisticsCommand({
          Namespace: 'AWS/EC2',
          MetricName: 'CPUUtilization',
          Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600, // 1 hour granularity
          Statistics: ['Average'],
        });

        const response = await client.send(command);
        const dataPoints = response.Datapoints || [];

        if (dataPoints.length > 0) {
          const avgCpu =
            dataPoints.reduce((sum, dp) => sum + (dp.Average || 0), 0) /
            dataPoints.length;

          if (avgCpu < cpuThreshold) {
            idleInstances.push({
              instanceId,
              averageCpuUtilization: avgCpu,
            });

            this.logger.log('Idle EC2 instance detected', {
              component: 'CloudWatchService',
              operation: 'findIdleEC2Instances',
              instanceId,
              averageCpu: avgCpu.toFixed(2),
              threshold: cpuThreshold,
              days,
              region: region || 'default',
            });
          }
        } else {
          // No metrics available - instance might be stopped or new
          this.logger.debug('No CPU metrics available for instance', {
            component: 'CloudWatchService',
            operation: 'findIdleEC2Instances',
            instanceId,
            region: region || 'default',
          });
        }
      } catch (error) {
        this.logger.warn('Failed to get metrics for instance', {
          component: 'CloudWatchService',
          operation: 'findIdleEC2Instances',
          instanceId,
          region: region || 'default',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log('Idle EC2 instances analysis completed', {
      component: 'CloudWatchService',
      operation: 'findIdleEC2Instances',
      totalInstances: instanceIds.length,
      idleInstances: idleInstances.length,
      cpuThreshold,
      days,
      region: region || 'default',
    });

    return idleInstances;
  }
}
