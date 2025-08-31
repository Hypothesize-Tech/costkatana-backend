import mongoose from 'mongoose';
import { loggingService } from '../services/logging.service';

export const connectDatabase = async (): Promise<void> => {
    try {
        const mongoUri = process.env.NODE_ENV === 'production'
            ? process.env.MONGODB_URI_PROD!
            : process.env.MONGODB_URI!;

        await mongoose.connect(mongoUri, {
            autoIndex: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        loggingService.info('MongoDB connected successfully', {
            component: 'DatabaseConfig',
            operation: 'connectDatabase',
            type: 'database'
        });

        mongoose.connection.on('error', (err) => {
            loggingService.logError(err, {
                component: 'DatabaseConfig',
                operation: 'connectDatabase',
                type: 'database',
                event: 'connection_error'
            });
        });

        mongoose.connection.on('disconnected', () => {
            loggingService.warn('MongoDB disconnected', {
                component: 'DatabaseConfig',
                operation: 'connectDatabase',
                type: 'database',
                event: 'disconnected'
            });
        });

        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            loggingService.info('MongoDB connection closed through app termination', {
                component: 'DatabaseConfig',
                operation: 'connectDatabase',
                type: 'database',
                event: 'graceful_shutdown'
            });
            process.exit(0);
        });
    } catch (error) {
        loggingService.logError(error as Error, {
            component: 'DatabaseConfig',
            operation: 'connectDatabase',
            type: 'database',
            event: 'connection_failed'
        });
        process.exit(1);
    }
};

export const disconnectDatabase = async (): Promise<void> => {
    await mongoose.connection.close();
    loggingService.info('MongoDB connection closed', {
        component: 'DatabaseConfig',
        operation: 'disconnectDatabase',
        type: 'database',
        event: 'manual_disconnect'
    });
};