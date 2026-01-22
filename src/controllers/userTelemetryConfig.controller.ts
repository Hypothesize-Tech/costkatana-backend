import { Request, Response } from 'express';
import { UserTelemetryConfig } from '../models/UserTelemetryConfig';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

/**
 * Get all telemetry configurations for a user
 */
export const getUserTelemetryConfigs = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getUserTelemetryConfigs', req);

    try {

        const configs = await UserTelemetryConfig.find({ userId, isActive: true })
            .select('-apiKey') // Don't expose API keys in list
            .sort({ createdAt: -1 });

        ControllerHelper.logRequestSuccess('getUserTelemetryConfigs', req, startTime, {
            count: configs.length
        });

        return res.status(200).json({
            success: true,
            data: configs
        });
    } catch (error) {
        ControllerHelper.handleError('getUserTelemetryConfigs', error, req, res, startTime);
        return res;
    }
};

/**
 * Get a single telemetry configuration
 */
export const getTelemetryConfig = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const startTime = Date.now();
    const { configId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getTelemetryConfig', req, { configId });

    try {
        ServiceHelper.validateObjectId(configId, 'configId');

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

        ControllerHelper.logRequestSuccess('getTelemetryConfig', req, startTime, { configId });

        return res.status(200).json({
            success: true,
            data: configData
        });
    } catch (error) {
        ControllerHelper.handleError('getTelemetryConfig', error, req, res, startTime, { configId });
        return res;
    }
};

/**
 * Create a new telemetry configuration
 */
export const createTelemetryConfig = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const startTime = Date.now();
    const { 
        endpointType, 
        endpoint, 
        authType, 
        authToken, 
        syncIntervalMinutes,
        queryTimeRangeMinutes,
        queryFilters 
    } = req.body;
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('createTelemetryConfig', req, { endpointType });

    try {

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

        // Mask auth token in response
        const responseData = config.toObject();
        if (responseData.authToken) {
            responseData.authToken = '***' + responseData.authToken.slice(-4);
        }

        ControllerHelper.logRequestSuccess('createTelemetryConfig', req, startTime, {
            configId: config._id,
            endpointType
        });

        return res.status(201).json({
            success: true,
            message: 'Telemetry configuration created successfully',
            data: responseData
        });
    } catch (error) {
        ControllerHelper.handleError('createTelemetryConfig', error, req, res, startTime);
        return res;
    }
};

/**
 * Update a telemetry configuration
 */
export const updateTelemetryConfig = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const startTime = Date.now();
    const { configId } = req.params;
    const { endpoint, authToken, syncIntervalMinutes, isActive, syncEnabled } = req.body;
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('updateTelemetryConfig', req, { configId });

    try {
        ServiceHelper.validateObjectId(configId, 'configId');

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

        // Mask auth token in response
        const responseData = config.toObject();
        if (responseData.authToken) {
            responseData.authToken = '***' + responseData.authToken.slice(-4);
        }

        ControllerHelper.logRequestSuccess('updateTelemetryConfig', req, startTime, { configId });

        return res.status(200).json({
            success: true,
            message: 'Configuration updated successfully',
            data: responseData
        });
    } catch (error) {
        ControllerHelper.handleError('updateTelemetryConfig', error, req, res, startTime, { configId });
        return res;
    }
};

/**
 * Delete a telemetry configuration (soft delete)
 */
export const deleteTelemetryConfig = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const startTime = Date.now();
    const { configId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('deleteTelemetryConfig', req, { configId });

    try {
        ServiceHelper.validateObjectId(configId, 'configId');

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

        ControllerHelper.logRequestSuccess('deleteTelemetryConfig', req, startTime, { configId });

        return res.status(200).json({
            success: true,
            message: 'Configuration deleted successfully'
        });
    } catch (error) {
        ControllerHelper.handleError('deleteTelemetryConfig', error, req, res, startTime, { configId });
        return res;
    }
};

/**
 * Test a telemetry endpoint connection
 */
export const testTelemetryEndpoint = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const startTime = Date.now();
    const { endpointType, endpoint, authToken } = req.body;
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('testTelemetryEndpoint', req, { endpointType });

    try {

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

            ControllerHelper.logRequestSuccess('testTelemetryEndpoint', req, startTime, {
                endpointType,
                statusCode: response.status,
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
        ControllerHelper.handleError('testTelemetryEndpoint', error, req, res, startTime);
        return res;
    }
};

/**
 * Trigger a manual sync for a specific config
 */
export const triggerManualSync = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    const startTime = Date.now();
    const { configId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('triggerManualSync', req, { configId });

    try {
        ServiceHelper.validateObjectId(configId, 'configId');

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

        ControllerHelper.logRequestSuccess('triggerManualSync', req, startTime, {
            configId,
            success: result.success
        });

        return res.status(200).json({
            success: true,
            message: 'Manual sync completed',
            data: result
        });
    } catch (error) {
        ControllerHelper.handleError('triggerManualSync', error, req, res, startTime, { configId });
        return res;
    }
};

