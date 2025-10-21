import { Request, Response } from 'express';
import { UserTelemetryConfig } from '../models/UserTelemetryConfig';
import { loggingService } from '../services/logging.service';

/**
 * Get all telemetry configurations for a user
 */
export const getUserTelemetryConfigs = async (req: Request, res: Response): Promise<Response> => {
    try {
        const userId = (req as any).user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        const configs = await UserTelemetryConfig.find({ userId, isActive: true })
            .select('-apiKey') // Don't expose API keys in list
            .sort({ createdAt: -1 });

        loggingService.info('Retrieved user telemetry configs', {
            component: 'UserTelemetryConfigController',
            operation: 'getUserTelemetryConfigs',
            userId,
            count: configs.length
        });

        return res.status(200).json({
            success: true,
            data: configs
        });
    } catch (error) {
        loggingService.error('Failed to retrieve telemetry configs', {
            component: 'UserTelemetryConfigController',
            operation: 'getUserTelemetryConfigs',
            error: error instanceof Error ? error.message : String(error)
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve telemetry configurations'
        });
    }
};

/**
 * Get a single telemetry configuration
 */
export const getTelemetryConfig = async (req: Request, res: Response): Promise<Response> => {
    try {
        const userId = (req as any).user?.userId;
        const { configId } = req.params;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        const config = await UserTelemetryConfig.findOne({
            _id: configId,
            userId
        });

        if (!config) {
            return res.status(404).json({
                success: false,
                message: 'Configuration not found'
            });
        }

        // Mask auth token for security
        const configData = config.toObject();
        if (configData.authToken) {
            configData.authToken = '***' + configData.authToken.slice(-4);
        }

        return res.status(200).json({
            success: true,
            data: configData
        });
    } catch (error) {
        loggingService.error('Failed to retrieve telemetry config', {
            component: 'UserTelemetryConfigController',
            operation: 'getTelemetryConfig',
            error: error instanceof Error ? error.message : String(error)
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve configuration'
        });
    }
};

/**
 * Create a new telemetry configuration
 */
export const createTelemetryConfig = async (req: Request, res: Response): Promise<Response> => {
    try {
        const userId = (req as any).user?.userId;
        const { 
            endpointType, 
            endpoint, 
            authType, 
            authToken, 
            syncIntervalMinutes,
            queryTimeRangeMinutes,
            queryFilters 
        } = req.body;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        // Validate required fields
        if (!endpointType || !endpoint) {
            return res.status(400).json({
                success: false,
                message: 'endpointType and endpoint are required'
            });
        }

        // Validate endpoint type
        const validTypes = ['tempo', 'jaeger', 'otlp-http', 'otlp-grpc', 'prometheus', 'custom'];
        if (!validTypes.includes(endpointType)) {
            return res.status(400).json({
                success: false,
                message: `Invalid endpointType. Must be one of: ${validTypes.join(', ')}`
            });
        }

        // Check for duplicate endpoint
        const existingConfig = await UserTelemetryConfig.findOne({
            userId,
            endpointType,
            endpoint,
            isActive: true
        });

        if (existingConfig) {
            return res.status(409).json({
                success: false,
                message: 'A configuration for this endpoint already exists'
            });
        }

        // Create new configuration
        const config = new UserTelemetryConfig({
            userId,
            endpointType,
            endpoint,
            authType: authType || 'none',
            authToken: authToken || undefined,
            syncIntervalMinutes: syncIntervalMinutes || 5,
            queryTimeRangeMinutes: queryTimeRangeMinutes || 10,
            queryFilters: queryFilters || undefined,
            isActive: true,
            syncEnabled: true,
            useTLS: endpoint.startsWith('https'),
            healthCheckEnabled: true
        });

        await config.save();

        loggingService.info('Created telemetry config', {
            component: 'UserTelemetryConfigController',
            operation: 'createTelemetryConfig',
            userId,
            endpointType,
            configId: config._id
        });

        // Mask auth token in response
        const responseData = config.toObject();
        if (responseData.authToken) {
            responseData.authToken = '***' + responseData.authToken.slice(-4);
        }

        return res.status(201).json({
            success: true,
            message: 'Telemetry configuration created successfully',
            data: responseData
        });
    } catch (error) {
        loggingService.error('Failed to create telemetry config', {
            component: 'UserTelemetryConfigController',
            operation: 'createTelemetryConfig',
            error: error instanceof Error ? error.message : String(error)
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to create configuration'
        });
    }
};

/**
 * Update a telemetry configuration
 */
export const updateTelemetryConfig = async (req: Request, res: Response): Promise<Response> => {
    try {
        const userId = (req as any).user?.userId;
        const { configId } = req.params;
        const { endpoint, authToken, syncIntervalMinutes, isActive, syncEnabled } = req.body;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        const config = await UserTelemetryConfig.findOne({
            _id: configId,
            userId
        });

        if (!config) {
            return res.status(404).json({
                success: false,
                message: 'Configuration not found'
            });
        }

        // Update fields
        if (endpoint !== undefined) config.endpoint = endpoint;
        if (authToken !== undefined) config.authToken = authToken;
        if (syncIntervalMinutes !== undefined) config.syncIntervalMinutes = syncIntervalMinutes;
        if (isActive !== undefined) config.isActive = isActive;
        if (syncEnabled !== undefined) config.syncEnabled = syncEnabled;

        await config.save();

        loggingService.info('Updated telemetry config', {
            component: 'UserTelemetryConfigController',
            operation: 'updateTelemetryConfig',
            userId,
            configId
        });

        // Mask auth token in response
        const responseData = config.toObject();
        if (responseData.authToken) {
            responseData.authToken = '***' + responseData.authToken.slice(-4);
        }

        return res.status(200).json({
            success: true,
            message: 'Configuration updated successfully',
            data: responseData
        });
    } catch (error) {
        loggingService.error('Failed to update telemetry config', {
            component: 'UserTelemetryConfigController',
            operation: 'updateTelemetryConfig',
            error: error instanceof Error ? error.message : String(error)
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to update configuration'
        });
    }
};

/**
 * Delete a telemetry configuration (soft delete)
 */
export const deleteTelemetryConfig = async (req: Request, res: Response): Promise<Response> => {
    try {
        const userId = (req as any).user?.userId;
        const { configId } = req.params;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        const config = await UserTelemetryConfig.findOne({
            _id: configId,
            userId
        });

        if (!config) {
            return res.status(404).json({
                success: false,
                message: 'Configuration not found'
            });
        }

        // Soft delete
        config.isActive = false;
        await config.save();

        loggingService.info('Deleted telemetry config', {
            component: 'UserTelemetryConfigController',
            operation: 'deleteTelemetryConfig',
            userId,
            configId
        });

        return res.status(200).json({
            success: true,
            message: 'Configuration deleted successfully'
        });
    } catch (error) {
        loggingService.error('Failed to delete telemetry config', {
            component: 'UserTelemetryConfigController',
            operation: 'deleteTelemetryConfig',
            error: error instanceof Error ? error.message : String(error)
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to delete configuration'
        });
    }
};

/**
 * Test a telemetry endpoint connection
 */
export const testTelemetryEndpoint = async (req: Request, res: Response): Promise<Response> => {
    try {
        const userId = (req as any).user?.userId;
        const { endpointType, endpoint, authToken } = req.body;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        if (!endpointType || !endpoint) {
            return res.status(400).json({
                success: false,
                message: 'endpointType and endpoint are required'
            });
        }

        // Basic connectivity test
        const axios = require('axios');
        const startTime = Date.now();

        try {
            const headers: any = {};
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            let testUrl = endpoint;
            if (endpointType === 'tempo') {
                testUrl = `${endpoint}/api/search?limit=1`;
            } else if (endpointType === 'jaeger') {
                testUrl = `${endpoint}/api/services`;
            }

            const response = await axios.get(testUrl, {
                headers,
                timeout: 10000,
                validateStatus: () => true // Accept any status for now
            });

            const responseTime = Date.now() - startTime;
            const isSuccess = response.status >= 200 && response.status < 400;

            loggingService.info('Tested telemetry endpoint', {
                component: 'UserTelemetryConfigController',
                operation: 'testTelemetryEndpoint',
                userId,
                endpointType,
                statusCode: response.status,
                responseTime,
                success: isSuccess
            });

            return res.status(200).json({
                success: true,
                data: {
                    reachable: isSuccess,
                    statusCode: response.status,
                    responseTime,
                    message: isSuccess
                        ? 'Endpoint is reachable and responding'
                        : `Endpoint returned status ${response.status}`
                }
            });
        } catch (axiosError: any) {
            return res.status(200).json({
                success: true,
                data: {
                    reachable: false,
                    error: axiosError.message,
                    message: 'Could not connect to endpoint'
                }
            });
        }
    } catch (error) {
        loggingService.error('Failed to test telemetry endpoint', {
            component: 'UserTelemetryConfigController',
            operation: 'testTelemetryEndpoint',
            error: error instanceof Error ? error.message : String(error)
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to test endpoint'
        });
    }
};

/**
 * Trigger a manual sync for a specific config
 */
export const triggerManualSync = async (req: Request, res: Response): Promise<Response> => {
    try {
        const userId = (req as any).user?.userId;
        const { configId } = req.params;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        const config = await UserTelemetryConfig.findOne({
            _id: configId,
            userId,
            isActive: true
        });

        if (!config) {
            return res.status(404).json({
                success: false,
                message: 'Configuration not found or inactive'
            });
        }

        // Import and trigger the poller service
        const { TelemetryPollerService } = await import('../services/telemetryPoller.service');
        const result = await TelemetryPollerService.pollSingleEndpoint(config);

        loggingService.info('Manual telemetry sync triggered', {
            component: 'UserTelemetryConfigController',
            operation: 'triggerManualSync',
            userId,
            configId,
            success: result.success
        });

        return res.status(200).json({
            success: true,
            message: 'Manual sync completed',
            data: result
        });
    } catch (error) {
        loggingService.error('Failed to trigger manual sync', {
            component: 'UserTelemetryConfigController',
            operation: 'triggerManualSync',
            error: error instanceof Error ? error.message : String(error)
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to trigger sync'
        });
    }
};

