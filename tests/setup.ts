// Set test environment BEFORE any imports
process.env.NODE_ENV = 'test';

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../src/models/User';
import { connectDatabase, disconnectDatabase } from '../src/config/database';

dotenv.config();

// Mock Redis to prevent connection issues
jest.mock('../src/services/redis.service', () => ({
    RedisService: {
        getInstance: jest.fn(() => ({
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            expire: jest.fn(),
            exists: jest.fn(),
            publish: jest.fn(),
            subscribe: jest.fn(),
            on: jest.fn(),
        })),
        disconnect: jest.fn(),
    },
}));

// Mock BullMQ to prevent Redis dependency
jest.mock('bullmq', () => ({
    Queue: jest.fn(() => ({
        add: jest.fn(),
        getJobs: jest.fn(),
        close: jest.fn(),
    })),
    Worker: jest.fn(() => ({
        on: jest.fn(),
        close: jest.fn(),
    })),
}));

// Use MongoDB Memory Server for tests instead of Atlas
let mongoServer: MongoMemoryServer;

// Increase Jest timeout for database operations
jest.setTimeout(30000);

beforeAll(async () => {
    try {
        // Disconnect any existing connections first
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }

        // Start in-memory MongoDB server
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();

        // Override the MongoDB URI to use the in-memory server
        process.env.MONGODB_URI = mongoUri;

        // Connect to the test database
        await connectDatabase();
    } catch (error) {
        console.error('Failed to setup test database:', error);
        throw error;
    }
});

afterAll(async () => {
    try {
        // Disconnect from database
        await disconnectDatabase();

        // Stop the MongoDB memory server
        if (mongoServer) {
            await mongoServer.stop();
        }
    } catch (error) {
        console.error('Failed to cleanup test database:', error);
    }
});

afterEach(async () => {
    try {
        // Clean up all test users after each test
        await User.deleteMany({ email: { $regex: /.*@example\.com$/ } });
    } catch (error) {
        console.warn('Failed to cleanup test users:', error);
    }
});
