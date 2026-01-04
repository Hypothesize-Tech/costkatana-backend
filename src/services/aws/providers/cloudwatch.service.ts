import { CloudWatchClient, GetMetricDataCommand, DescribeAlarmsCommand, ListMetricsCommand, GetDashboardCommand, ListDashboardsCommand } from '@aws-sdk/client-cloudwatch';
import { loggingService } from '../../logging.service';
import { stsCredentialService } from '../stsCredential.service';
import { permissionBoundaryService } from '../permissionBoundary.service';
import { IAWSConnection } from '../../../models/AWSConnection';

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

class CloudWatchServiceProvider {
  private static instance: CloudWatchServiceProvider;
  
  private constructor() {}
  
  public static getInstance(): CloudWatchServiceProvider {
    if (!CloudWatchServiceProvider.instance) {
      CloudWatchServiceProvider.instance = new CloudWatchServiceProvider();
    }
    return CloudWatchServiceProvider.instance;
  }
  
  private async getClient(connection: IAWSConnection, region?: string): Promise<CloudWatchClient> {
    const credentials = await stsCredentialService.assumeRole(connection);
    
    return new CloudWatchClient({
      region: region || connection.allowedRegions[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }
  
  /**
   * Get metric data
   */
  public async getMetricData(
    connection: IAWSConnection,
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
    region?: string
  ): Promise<MetricResult[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'GetMetricData', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    const command = new GetMetricDataCommand({
      MetricDataQueries: queries.map(q => ({
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
    
    loggingService.info('CloudWatch metrics retrieved', {
      component: 'CloudWatchServiceProvider',
      operation: 'getMetricData',
      connectionId: connection._id.toString(),
      queryCount: queries.length,
      resultCount: results.length,
      region,
    });
    
    return results;
  }
  
  /**
   * Get EC2 CPU utilization
   */
  public async getEC2CPUUtilization(
    connection: IAWSConnection,
    instanceId: string,
    startTime: Date,
    endTime: Date,
    period: number = 3600,
    region?: string
  ): Promise<MetricDataPoint[]> {
    const results = await this.getMetricData(
      connection,
      [{
        id: 'cpu',
        namespace: 'AWS/EC2',
        metricName: 'CPUUtilization',
        dimensions: [{ Name: 'InstanceId', Value: instanceId }],
        stat: 'Average',
        period,
      }],
      startTime,
      endTime,
      region
    );
    
    return results[0]?.dataPoints || [];
  }
  
  /**
   * Get RDS CPU utilization
   */
  public async getRDSCPUUtilization(
    connection: IAWSConnection,
    dbInstanceId: string,
    startTime: Date,
    endTime: Date,
    period: number = 3600,
    region?: string
  ): Promise<MetricDataPoint[]> {
    const results = await this.getMetricData(
      connection,
      [{
        id: 'cpu',
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensions: [{ Name: 'DBInstanceIdentifier', Value: dbInstanceId }],
        stat: 'Average',
        period,
      }],
      startTime,
      endTime,
      region
    );
    
    return results[0]?.dataPoints || [];
  }
  
  /**
   * Get Lambda invocations and duration
   */
  public async getLambdaMetrics(
    connection: IAWSConnection,
    functionName: string,
    startTime: Date,
    endTime: Date,
    period: number = 3600,
    region?: string
  ): Promise<{ invocations: MetricDataPoint[]; duration: MetricDataPoint[]; errors: MetricDataPoint[] }> {
    const results = await this.getMetricData(
      connection,
      [
        {
          id: 'invocations',
          namespace: 'AWS/Lambda',
          metricName: 'Invocations',
          dimensions: [{ Name: 'FunctionName', Value: functionName }],
          stat: 'Sum',
          period,
        },
        {
          id: 'duration',
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          dimensions: [{ Name: 'FunctionName', Value: functionName }],
          stat: 'Average',
          period,
        },
        {
          id: 'errors',
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensions: [{ Name: 'FunctionName', Value: functionName }],
          stat: 'Sum',
          period,
        },
      ],
      startTime,
      endTime,
      region
    );
    
    return {
      invocations: results.find(r => r.id === 'invocations')?.dataPoints || [],
      duration: results.find(r => r.id === 'duration')?.dataPoints || [],
      errors: results.find(r => r.id === 'errors')?.dataPoints || [],
    };
  }
  
  /**
   * List CloudWatch alarms
   */
  public async listAlarms(
    connection: IAWSConnection,
    region?: string
  ): Promise<CloudWatchAlarm[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'DescribeAlarms', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    const command = new DescribeAlarmsCommand({
      MaxRecords: 100,
    });
    
    const response = await client.send(command);
    
    return (response.MetricAlarms || []).map(alarm => ({
      alarmName: alarm.AlarmName || '',
      alarmArn: alarm.AlarmArn || '',
      stateValue: alarm.StateValue || 'UNKNOWN',
      metricName: alarm.MetricName || '',
      namespace: alarm.Namespace || '',
      threshold: alarm.Threshold || 0,
      comparisonOperator: alarm.ComparisonOperator || '',
    }));
  }
  
  /**
   * List available metrics
   */
  public async listMetrics(
    connection: IAWSConnection,
    namespace?: string,
    region?: string
  ): Promise<CloudWatchMetric[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'ListMetrics', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    const command = new ListMetricsCommand({
      Namespace: namespace,
    });
    
    const response = await client.send(command);
    
    return (response.Metrics || []).map(metric => ({
      namespace: metric.Namespace || '',
      metricName: metric.MetricName || '',
      dimensions: (metric.Dimensions || []).map(d => ({
        name: d.Name || '',
        value: d.Value || '',
      })),
    }));
  }
  
  /**
   * Get dashboard
   */
  public async getDashboard(
    connection: IAWSConnection,
    dashboardName: string,
    region?: string
  ): Promise<{ name: string; body: string } | null> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'GetDashboard', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    try {
      const command = new GetDashboardCommand({
        DashboardName: dashboardName,
      });
      
      const response = await client.send(command);
      
      return {
        name: response.DashboardName || dashboardName,
        body: response.DashboardBody || '',
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * List dashboards
   */
  public async listDashboards(
    connection: IAWSConnection,
    region?: string
  ): Promise<Array<{ name: string; arn: string }>> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'cloudwatch', action: 'ListDashboards', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    const command = new ListDashboardsCommand({});
    const response = await client.send(command);
    
    return (response.DashboardEntries || []).map(d => ({
      name: d.DashboardName || '',
      arn: d.DashboardArn || '',
    }));
  }
  
  /**
   * Find idle resources based on CloudWatch metrics
   */
  public async findIdleEC2Instances(
    connection: IAWSConnection,
    instanceIds: string[],
    cpuThreshold: number = 5,
    days: number = 7,
    region?: string
  ): Promise<string[]> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);
    
    const idleInstances: string[] = [];
    
    for (const instanceId of instanceIds) {
      const dataPoints = await this.getEC2CPUUtilization(
        connection,
        instanceId,
        startTime,
        endTime,
        3600,
        region
      );
      
      if (dataPoints.length > 0) {
        const avgCpu = dataPoints.reduce((sum, dp) => sum + dp.value, 0) / dataPoints.length;
        
        if (avgCpu < cpuThreshold) {
          idleInstances.push(instanceId);
        }
      }
    }
    
    return idleInstances;
  }
}

export const cloudWatchServiceProvider = CloudWatchServiceProvider.getInstance();
