import { PutMetricDataCommand, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { cloudWatchClient, AWS_CONFIG } from '../config/aws';
import { loggingService } from './logging.service';

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
}