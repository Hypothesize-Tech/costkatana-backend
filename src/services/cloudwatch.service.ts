import { PutMetricDataCommand, GetMetricStatisticsCommand, PutMetricAlarmCommand } from '@aws-sdk/client-cloudwatch';
import { 
    CreateLogGroupCommand, 
    CreateLogStreamCommand, 
    PutLogEventsCommand,
    DescribeLogGroupsCommand
} from '@aws-sdk/client-cloudwatch-logs';
import { cloudWatchClient, AWS_CONFIG } from '../config/aws';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { loggingService } from './logging.service';

// CloudWatch Logs client
const cloudWatchLogsClient = new CloudWatchLogsClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
});

interface MetricData {
    metricName: string;
    value: number;
    unit: 'Count' | 'None' | 'Milliseconds' | 'Bytes' | 'Percent';
    dimensions?: Array<{
        name: string;
        value: string;
    }>;
    timestamp?: Date;
}

interface MetricQuery {
    metricName: string;
    startTime: Date;
    endTime: Date;
    period: number; // in seconds
    stat: 'Average' | 'Sum' | 'Minimum' | 'Maximum' | 'SampleCount';
    dimensions?: Array<{
        name: string;
        value: string;
    }>;
}

export class CloudWatchService {
    static async sendMetrics(data: {
        namespace: string;
        metricData: MetricData[];
    }): Promise<void> {
        try {
            const command = new PutMetricDataCommand({
                Namespace: data.namespace,
                MetricData: data.metricData.map(metric => ({
                    MetricName: metric.metricName,
                    Value: metric.value,
                    Unit: metric.unit,
                    Dimensions: metric.dimensions?.map(d => ({
                        Name: d.name,
                        Value: d.value,
                    })),
                    Timestamp: metric.timestamp || new Date(),
                })),
            });

            await cloudWatchClient.send(command);

            loggingService.debug('CloudWatch metrics sent', { value:  { namespace: data.namespace,
                metricsCount: data.metricData.length,
             } });
        } catch (error) {
            loggingService.error('Error sending CloudWatch metrics:', { error: error instanceof Error ? error.message : String(error) });
            // Don't throw - metrics are not critical
        }
    }

    static async getMetrics(query: MetricQuery): Promise<any> {
        try {
            const command = new GetMetricStatisticsCommand({
                Namespace: AWS_CONFIG.cloudWatch.namespace,
                MetricName: query.metricName,
                StartTime: query.startTime,
                EndTime: query.endTime,
                Period: query.period,
                Statistics: [query.stat],
                Dimensions: query.dimensions?.map(d => ({
                    Name: d.name,
                    Value: d.value,
                })),
            });

            const response = await cloudWatchClient.send(command);

            return {
                label: response.Label,
                datapoints: response.Datapoints?.map(dp => ({
                    timestamp: dp.Timestamp,
                    value: dp[query.stat] || 0,
                    unit: dp.Unit,
                })).sort((a, b) =>
                    (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0)
                ),
            };
        } catch (error) {
            loggingService.error('Error getting CloudWatch metrics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async sendCustomMetric(
        metricName: string,
        value: number,
        unit: MetricData['unit'] = 'None',
        dimensions?: MetricData['dimensions']
    ): Promise<void> {
        await this.sendMetrics({
            namespace: AWS_CONFIG.cloudWatch.namespace,
            metricData: [{
                metricName,
                value,
                unit,
                dimensions,
            }],
        });
    }

    static async trackApiLatency(
        service: string,
        model: string,
        latency: number
    ): Promise<void> {
        await this.sendMetrics({
            namespace: AWS_CONFIG.cloudWatch.namespace,
            metricData: [{
                metricName: 'APILatency',
                value: latency,
                unit: 'Milliseconds',
                dimensions: [
                    { name: 'Service', value: service },
                    { name: 'Model', value: model },
                ],
            }],
        });
    }

    static async trackError(
        errorType: string,
        service?: string
    ): Promise<void> {
        const dimensions = [{ name: 'ErrorType', value: errorType }];
        if (service) {
            dimensions.push({ name: 'Service', value: service });
        }

        await this.sendMetrics({
            namespace: AWS_CONFIG.cloudWatch.namespace,
            metricData: [{
                metricName: 'Errors',
                value: 1,
                unit: 'Count',
                dimensions,
            }],
        });
    }

    static async createDashboard(userId: string): Promise<void> {
        // Implementation for creating custom CloudWatch dashboards
        // This would use PutDashboardCommand from AWS SDK
        loggingService.info('Dashboard creation not implemented yet', { value:  {  userId  } });
    }
    
    /**
     * ============ AI-SPECIFIC CLOUDWATCH FEATURES ============
     */
    
    /**
     * Create or get log group for a project
     */
    static async ensureLogGroup(projectId: string): Promise<string> {
        const logGroupName = `/costkatana/ai-logs/${projectId}`;
        
        try {
            // Check if log group exists
            const describeCommand = new DescribeLogGroupsCommand({
                logGroupNamePrefix: logGroupName
            });
            
            const existing = await cloudWatchLogsClient.send(describeCommand);
            
            if (!existing.logGroups || existing.logGroups.length === 0) {
                // Create log group
                const createCommand = new CreateLogGroupCommand({
                    logGroupName
                });
                
                await cloudWatchLogsClient.send(createCommand);
                
                loggingService.info('Created CloudWatch log group', {
                    component: 'CloudWatchService',
                    logGroupName
                });
            }
            
            return logGroupName;
        } catch (error) {
            loggingService.error('Failed to ensure log group', {
                component: 'CloudWatchService',
                error: error instanceof Error ? error.message : String(error),
                logGroupName
            });
            throw error;
        }
    }
    
    /**
     * Create log stream for a service/model combination
     */
    static async ensureLogStream(logGroupName: string, service: string, model: string): Promise<string> {
        const logStreamName = `${service}/${model}/${new Date().toISOString().split('T')[0]}`;
        
        try {
            const command = new CreateLogStreamCommand({
                logGroupName,
                logStreamName
            });
            
            await cloudWatchLogsClient.send(command);
            
            return logStreamName;
        } catch (error: any) {
            // ResourceAlreadyExistsException is okay
            if (error.name === 'ResourceAlreadyExistsException') {
                return logStreamName;
            }
            
            loggingService.error('Failed to create log stream', {
                component: 'CloudWatchService',
                error: error instanceof Error ? error.message : String(error),
                logGroupName,
                logStreamName
            });
            
            throw error;
        }
    }
    
    /**
     * Send AI log events to CloudWatch Logs
     */
    static async sendAILogEvents(
        logGroupName: string,
        logStreamName: string,
        events: Array<{ timestamp: Date; message: string }>
    ): Promise<void> {
        try {
            const command = new PutLogEventsCommand({
                logGroupName,
                logStreamName,
                logEvents: events.map(event => ({
                    timestamp: event.timestamp.getTime(),
                    message: event.message
                }))
            });
            
            await cloudWatchLogsClient.send(command);
            
            loggingService.debug('Sent AI log events to CloudWatch', {
                component: 'CloudWatchService',
                eventsCount: events.length
            });
        } catch (error) {
            loggingService.error('Failed to send log events to CloudWatch', {
                component: 'CloudWatchService',
                error: error instanceof Error ? error.message : String(error)
            });
            // Don't throw - logging should not block operations
        }
    }
    
    /**
     * Create AI-specific metric alarm
     */
    static async createAIAlarm(config: {
        alarmName: string;
        metricName: string;
        threshold: number;
        comparisonOperator: 'GreaterThanThreshold' | 'LessThanThreshold' | 'GreaterThanOrEqualToThreshold';
        evaluationPeriods: number;
        period: number;
        dimensions?: Array<{ name: string; value: string }>;
        description?: string;
    }): Promise<void> {
        try {
            const command = new PutMetricAlarmCommand({
                AlarmName: config.alarmName,
                ComparisonOperator: config.comparisonOperator,
                EvaluationPeriods: config.evaluationPeriods,
                MetricName: config.metricName,
                Namespace: 'CostKatana/AI-Operations',
                Period: config.period,
                Statistic: 'Average',
                Threshold: config.threshold,
                ActionsEnabled: false, // Enable when SNS topics are configured
                AlarmDescription: config.description || `AI monitoring alarm for ${config.metricName}`,
                Dimensions: config.dimensions?.map(d => ({
                    Name: d.name,
                    Value: d.value
                })),
                TreatMissingData: 'notBreaching'
            });
            
            await cloudWatchClient.send(command);
            
            loggingService.info('Created AI metric alarm', {
                component: 'CloudWatchService',
                alarmName: config.alarmName
            });
        } catch (error) {
            loggingService.error('Failed to create AI alarm', {
                component: 'CloudWatchService',
                error: error instanceof Error ? error.message : String(error),
                alarmName: config.alarmName
            });
            throw error;
        }
    }
    
    /**
     * Track AI operation with comprehensive metrics
     */
    static async trackAIOperation(data: {
        service: string;
        model: string;
        operation: string;
        success: boolean;
        latency: number;
        inputTokens: number;
        outputTokens: number;
        cost: number;
        projectId?: string;
        errorType?: string;
    }): Promise<void> {
        const metrics: MetricData[] = [];
        
        // Call count
        metrics.push({
            metricName: 'AICallCount',
            value: 1,
            unit: 'Count',
            dimensions: [
                { name: 'Service', value: data.service },
                { name: 'Model', value: data.model },
                { name: 'Operation', value: data.operation },
                { name: 'Success', value: data.success.toString() }
            ]
        });
        
        // Latency
        metrics.push({
            metricName: 'AILatency',
            value: data.latency,
            unit: 'Milliseconds',
            dimensions: [
                { name: 'Service', value: data.service },
                { name: 'Model', value: data.model }
            ]
        });
        
        // Token usage
        metrics.push({
            metricName: 'AITokenUsage',
            value: data.inputTokens + data.outputTokens,
            unit: 'Count',
            dimensions: [
                { name: 'Service', value: data.service },
                { name: 'Model', value: data.model },
                { name: 'TokenType', value: 'total' }
            ]
        });
        
        metrics.push({
            metricName: 'AITokenUsage',
            value: data.inputTokens,
            unit: 'Count',
            dimensions: [
                { name: 'Service', value: data.service },
                { name: 'Model', value: data.model },
                { name: 'TokenType', value: 'input' }
            ]
        });
        
        metrics.push({
            metricName: 'AITokenUsage',
            value: data.outputTokens,
            unit: 'Count',
            dimensions: [
                { name: 'Service', value: data.service },
                { name: 'Model', value: data.model },
                { name: 'TokenType', value: 'output' }
            ]
        });
        
        // Cost
        metrics.push({
            metricName: 'AICost',
            value: data.cost,
            unit: 'None',
            dimensions: [
                { name: 'Service', value: data.service },
                { name: 'Model', value: data.model },
                ...(data.projectId ? [{ name: 'ProjectId', value: data.projectId }] : [])
            ]
        });
        
        // Error tracking
        if (!data.success && data.errorType) {
            metrics.push({
                metricName: 'AIErrorCount',
                value: 1,
                unit: 'Count',
                dimensions: [
                    { name: 'Service', value: data.service },
                    { name: 'Model', value: data.model },
                    { name: 'ErrorType', value: data.errorType }
                ]
            });
        }
        
        await this.sendMetrics({
            namespace: 'CostKatana/AI-Operations',
            metricData: metrics
        });
    }
    
    /**
     * Get AI metrics for analysis
     */
    static async getAIMetrics(config: {
        metricName: string;
        service?: string;
        model?: string;
        startTime: Date;
        endTime: Date;
        period: number;
        stat: 'Average' | 'Sum' | 'Minimum' | 'Maximum';
    }): Promise<any> {
        const dimensions: Array<{ name: string; value: string }> = [];
        
        if (config.service) {
            dimensions.push({ name: 'Service', value: config.service });
        }
        if (config.model) {
            dimensions.push({ name: 'Model', value: config.model });
        }
        
        return this.getMetrics({
            metricName: config.metricName,
            startTime: config.startTime,
            endTime: config.endTime,
            period: config.period,
            stat: config.stat,
            dimensions: dimensions.length > 0 ? dimensions : undefined
        });
    }
    
    /**
     * Setup default AI monitoring alarms
     */
    static async setupDefaultAIAlarms(projectId: string): Promise<void> {
        try {
            // High error rate alarm (>5% errors)
            await this.createAIAlarm({
                alarmName: `${projectId}-high-error-rate`,
                metricName: 'AIErrorCount',
                threshold: 0.05, // 5%
                comparisonOperator: 'GreaterThanThreshold',
                evaluationPeriods: 2,
                period: 300, // 5 minutes
                description: `High AI error rate for project ${projectId}`
            });
            
            // High latency alarm (>5 seconds average)
            await this.createAIAlarm({
                alarmName: `${projectId}-high-latency`,
                metricName: 'AILatency',
                threshold: 5000,
                comparisonOperator: 'GreaterThanThreshold',
                evaluationPeriods: 3,
                period: 300,
                description: `High AI latency for project ${projectId}`
            });
            
            // High cost alarm (cost spike detection)
            await this.createAIAlarm({
                alarmName: `${projectId}-cost-spike`,
                metricName: 'AICost',
                threshold: 1.0, // $1 per period
                comparisonOperator: 'GreaterThanThreshold',
                evaluationPeriods: 1,
                period: 300,
                dimensions: [{ name: 'ProjectId', value: projectId }],
                description: `Cost spike detected for project ${projectId}`
            });
            
            loggingService.info('Setup default AI alarms', {
                component: 'CloudWatchService',
                projectId
            });
        } catch (error) {
            loggingService.error('Failed to setup default AI alarms', {
                component: 'CloudWatchService',
                error: error instanceof Error ? error.message : String(error),
                projectId
            });
            // Don't throw - alarm setup failures should not block operations
        }
    }
}