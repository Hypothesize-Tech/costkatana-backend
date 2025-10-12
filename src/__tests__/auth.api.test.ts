import { expect } from '@playwright/test';
import request from 'supertest';
import app from '../server';
import { User } from '../models/User';
import { AuthService } from '../services/auth.service';
import { connectDatabase, disconnectDatabase } from '../config/database';

const API_BASE = '/api/auth';

describe('Authentication API Endpoints', () => {
    let accessToken: string;
    let refreshToken: string;

    beforeAll(async () => {
        // Set test environment
        process.env.NODE_ENV = 'test';
        process.env.JWT_SECRET = 'test-jwt-secret';
    });

    describe('POST /auth/register', () => {
        it('should register a new user successfully', async () => {
            const newUser = {
                email: 'newuser@example.com',
                name: 'New User',
                password: 'Password123!',
                confirmPassword: 'Password123!'
            };

            const response = await request(app)
                .post(`${API_BASE}/register`)
                .send(newUser)
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.data.user).toBeDefined();
            expect(response.body.data.user.email).toBe(newUser.email);
            expect(response.body.data.accessToken).toBeDefined();
            expect(response.body.data.refreshToken).toBeDefined();

            // Store tokens for cleanup
            accessToken = response.body.data.accessToken;
            refreshToken = response.body.data.refreshToken;

            // Clean up the created user
            const createdUser = await User.findOne({ email: newUser.email });
            if (createdUser) {
                await User.findByIdAndDelete(createdUser._id);
            }
        });

        it('should return 409 for existing email', async () => {
            // First, ensure we have a user with the email we're testing
            const existingUserData = {
                email: 'existinguser@example.com',
                name: 'Existing User',
                password: 'Password123!',
                confirmPassword: 'Password123!'
            };

            // Create the user first
            await request(app)
                .post(`${API_BASE}/register`)
                .send(existingUserData)
                .expect(201);

            // Now try to register again with the same email
            const response = await request(app)
                .post(`${API_BASE}/register`)
                .send(existingUserData)
                .expect(409);

            expect(response.body.success).toBe(false);
            expect(response.body.message).toContain('already exists');
        });

        it('should validate required fields', async () => {
            const invalidUser = {
                email: 'invalid-email', // Invalid email format
                name: '',
                password: '123' // Too short
            };

            const response = await request(app)
                .post(`${API_BASE}/register`)
                .send(invalidUser)
                .expect(400);

            expect(response.body.success).toBe(false);
        });
    });

    describe('POST /auth/login', () => {
        it('should login successfully with valid credentials', async () => {
            // First create a user with a known password
            const loginUser = await User.create({
                email: 'login-test@example.com',
                name: 'Login Test User',
                password: 'TestPassword123!',
                role: 'user',
                isActive: true,
                emailVerified: true,
                subscription: {
                    plan: 'free',
                    startDate: new Date(),
                    limits: { apiCalls: 1000, optimizations: 10 }
                },
                usage: {
                    currentMonth: { apiCalls: 0, totalCost: 0, optimizationsSaved: 0 }
                },
                preferences: {
                    emailAlerts: true,
                    alertThreshold: 100,
                    optimizationSuggestions: true
                },
                apiKeys: []
            });

            const loginData = {
                email: 'login-test@example.com',
                password: 'TestPassword123!'
            };

            const response = await request(app)
                .post(`${API_BASE}/login`)
                .send(loginData)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.user).toBeDefined();
            expect(response.body.data.user.email).toBe(loginData.email);
            expect(response.body.data.accessToken).toBeDefined();
            expect(response.body.data.refreshToken).toBeDefined();

            // Store tokens
            accessToken = response.body.data.accessToken;
            refreshToken = response.body.data.refreshToken;

            // Clean up
            await User.findByIdAndDelete(loginUser._id);
        });

        it('should handle MFA-enabled login flow', async () => {
            // Create a user with MFA enabled
            const mfaUser = await User.create({
                email: 'mfa-test@example.com',
                name: 'MFA Test User',
                password: 'TestPassword123!',
                role: 'user',
                isActive: true,
                emailVerified: true,
                mfa: {
                    enabled: true,
                    methods: ['email', 'totp'],
                    secret: 'ABCDEFGHIJKLMNOP',
                    backupCodes: ['12345678', '87654321']
                },
                subscription: {
                    plan: 'free',
                    startDate: new Date(),
                    limits: { apiCalls: 1000, optimizations: 10 }
                },
                usage: {
                    currentMonth: { apiCalls: 0, totalCost: 0, optimizationsSaved: 0 }
                },
                preferences: {
                    emailAlerts: true,
                    alertThreshold: 100,
                    optimizationSuggestions: true
                },
                apiKeys: []
            });

            const loginData = {
                email: 'mfa-test@example.com',
                password: 'TestPassword123!'
            };

            const response = await request(app)
                .post(`${API_BASE}/login`)
                .send(loginData)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.requiresMFA).toBe(true);
            expect(response.body.data.mfaToken).toBeDefined();
            expect(response.body.data.userId).toBeDefined();
            expect(response.body.data.availableMethods).toEqual(['email', 'totp']);

            // Clean up
            await User.findByIdAndDelete(mfaUser._id);
        });

        it('should return 401 for invalid credentials', async () => {
            const invalidLogin = {
                email: 'test@example.com',
                password: 'wrongpassword'
            };

            const response = await request(app)
                .post(`${API_BASE}/login`)
                .send(invalidLogin)
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.message).toBe('Invalid email or password');
        });

        it('should return 403 for deactivated account', async () => {
            // Create a deactivated user
            const deactivatedUser = await User.create({
                email: 'deactivated@example.com',
                name: 'Deactivated User',
                password: 'TestPassword123!',
                role: 'user',
                isActive: false, // Deactivated
                emailVerified: true,
                subscription: {
                    plan: 'free',
                    startDate: new Date(),
                    limits: { apiCalls: 1000, optimizations: 10 }
                },
                usage: {
                    currentMonth: { apiCalls: 0, totalCost: 0, optimizationsSaved: 0 }
                },
                preferences: {
                    emailAlerts: true,
                    alertThreshold: 100,
                    optimizationSuggestions: true
                },
                apiKeys: []
            });

            const loginData = {
                email: 'deactivated@example.com',
                password: 'TestPassword123!'
            };

            const response = await request(app)
                .post(`${API_BASE}/login`)
                .send(loginData)
                .expect(403);

            expect(response.body.success).toBe(false);
            expect(response.body.message).toBe('Your account has been deactivated');

            // Clean up
            await User.findByIdAndDelete(deactivatedUser._id);
        });
    });

    describe('POST /auth/refresh', () => {
        it('should refresh tokens successfully', async () => {
            // Create a test user and login to get tokens
            const testUser = await User.create({
                email: 'refresh-test@example.com',
                name: 'Refresh Test User',
                password: 'TestPassword123!',
                role: 'user',
                isActive: true,
                emailVerified: true,
                subscription: {
                    plan: 'free',
                    startDate: new Date(),
                    limits: { apiCalls: 1000, optimizations: 10 }
                },
                usage: {
                    currentMonth: { apiCalls: 0, totalCost: 0, optimizationsSaved: 0 }
                },
                preferences: {
                    emailAlerts: true,
                    alertThreshold: 100,
                    optimizationSuggestions: true
                },
                apiKeys: []
            });

            // Login to get tokens
            const loginResponse = await request(app)
                .post(`${API_BASE}/login`)
                .send({
                    email: 'refresh-test@example.com',
                    password: 'TestPassword123!'
                })
                .expect(200);

            const refreshToken = loginResponse.body.data.refreshToken;

            // Now test token refresh
            const response = await request(app)
                .post(`${API_BASE}/refresh`)
                .set('Cookie', `refreshToken=${refreshToken}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data.accessToken).toBeDefined();

            // Clean up
            await User.findByIdAndDelete(testUser._id);
        });

        it('should return 401 for missing refresh token', async () => {
            const response = await request(app)
                .post(`${API_BASE}/refresh`)
                .expect(401);

            expect(response.body.success).toBe(false);
            expect(response.body.message).toBe('Refresh token not provided');
        });
    });

    describe('POST /auth/logout', () => {
        it('should logout successfully', async () => {
            const response = await request(app)
                .post(`${API_BASE}/logout`)
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe('Logout successful');
        });
    });

    describe('POST /auth/forgot-password', () => {
        it('should initiate password reset', async () => {
            const response = await request(app)
                .post(`${API_BASE}/forgot-password`)
                .send({ email: 'test@example.com' })
                .expect(200);

            // Should always return success for security reasons
            expect(response.body.success).toBe(true);
            expect(response.body.message).toBeDefined();
        });

        it('should return success for non-existent email', async () => {
            const response = await request(app)
                .post(`${API_BASE}/forgot-password`)
                .send({ email: 'nonexistent@example.com' })
                .expect(200);

            // Should always return success for security reasons
            expect(response.body.success).toBe(true);
        });
    });

    describe('GET /auth/verify-email/:token', () => {
        it('should verify email with valid token', async () => {
            // Create a user with unverified email
            const unverifiedUser = await User.create({
                email: 'unverified@example.com',
                name: 'Unverified User',
                password: 'TestPassword123!',
                role: 'user',
                isActive: true,
                emailVerified: false,
                verificationToken: 'valid-verification-token',
                subscription: {
                    plan: 'free',
                    startDate: new Date(),
                    limits: { apiCalls: 1000, optimizations: 10 }
                },
                usage: {
                    currentMonth: { apiCalls: 0, totalCost: 0, optimizationsSaved: 0 }
                },
                preferences: {
                    emailAlerts: true,
                    alertThreshold: 100,
                    optimizationSuggestions: true
                },
                apiKeys: []
            });

            const response = await request(app)
                .get(`${API_BASE}/verify-email/valid-verification-token`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe('Email verified successfully');

            // Clean up
            await User.findByIdAndDelete(unverifiedUser._id);
        });

        it('should return 400 for invalid token', async () => {
            const response = await request(app)
                .get(`${API_BASE}/verify-email/invalid-token`)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.message).toBe('Invalid or expired verification token');
        });
    });

    describe('POST /auth/reset-password/:token', () => {
        it('should reset password with valid token', async () => {
            // Create a user with reset token
            const resetUser = await User.create({
                email: 'reset@example.com',
                name: 'Reset User',
                password: 'OldPassword123!',
                role: 'user',
                isActive: true,
                emailVerified: true,
                resetPasswordToken: 'valid-reset-token',
                resetPasswordExpires: new Date(Date.now() + 3600000), // 1 hour from now
                subscription: {
                    plan: 'free',
                    startDate: new Date(),
                    limits: { apiCalls: 1000, optimizations: 10 }
                },
                usage: {
                    currentMonth: { apiCalls: 0, totalCost: 0, optimizationsSaved: 0 }
                },
                preferences: {
                    emailAlerts: true,
                    alertThreshold: 100,
                    optimizationSuggestions: true
                },
                apiKeys: []
            });

            const response = await request(app)
                .post(`${API_BASE}/reset-password/valid-reset-token`)
                .send({ password: 'NewPassword123!' })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe('Password reset successful');

            // Clean up
            await User.findByIdAndDelete(resetUser._id);
        });

        it('should return 400 for invalid reset token', async () => {
            const response = await request(app)
                .post(`${API_BASE}/reset-password/invalid-token`)
                .send({ password: 'NewPassword123!' })
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.message).toBe('Invalid or expired reset token');
        });
    });
});
