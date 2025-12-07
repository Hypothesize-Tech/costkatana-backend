import { Request, Response } from 'express';
import { User } from '../models/User';
import { ProjectService } from '../services/project.service';
import { loggingService } from '../services/logging.service';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

export class OnboardingController {
    // Circuit breaker for external services
    private static emailFailureCount: number = 0;
    private static readonly MAX_EMAIL_FAILURES = 3;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 60000; // 1 minute
    private static lastEmailFailureTime: number = 0;
    
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor: NodeJS.Timeout | null = null;
    
    // Smart logging batch
    private static logBatch: any[] = [];
    private static logBatchTimer?: NodeJS.Timeout;

    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }

    static async generateMagicLink(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const { email, name, source = 'ChatGPT' } = req.body;

        try {
            loggingService.info('Magic link generation initiated', {
                email,
                hasEmail: !!email,
                name,
                hasName: !!name,
                source,
                hasSource: !!source,
                requestId: req.headers['x-request-id'] as string
            });

            if (!email) {
                loggingService.warn('Magic link generation failed - email is required', {
                    name,
                    hasName: !!name,
                    source,
                    hasSource: !!source,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Email is required'
                });
                return;
            }

            loggingService.info('Magic link generation processing started', {
                email,
                name,
                hasName: !!name,
                source,
                requestId: req.headers['x-request-id'] as string
            });

            // Generate session ID and tokens (shorter for URL compatibility)
            const sessionId = crypto.randomBytes(8).toString('hex'); // Reduced from 16 to 8 bytes
            const token = crypto.randomBytes(32).toString('hex');

            // Create magic link data with shorter field names
            const magicLinkData = {
                e: email,           // email -> e
                n: name,            // name -> n  
                s: source,          // source -> s
                sid: sessionId,     // sessionId -> sid
                c: Math.floor(Date.now() / 1000),  // createdAt -> c (Unix timestamp)
                x: Math.floor((Date.now() + 15 * 60 * 1000) / 1000) // expiresAt -> x (Unix timestamp)
            };

            // Encode the data
            const encodedData = Buffer.from(JSON.stringify(magicLinkData)).toString('base64');

            // Create magic link
            const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '') || 'http://localhost:3000';
            const magicLink = `${frontendUrl}/connect/chatgpt?token=${token}&data=${encodedData}`;

            const duration = Date.now() - startTime;

            loggingService.info('Magic link generated successfully', {
                email,
                sessionId,
                source,
                duration,
                hasMagicLink: !!magicLink,
                frontendUrl,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'magic_link_generated',
                category: 'onboarding_operations',
                value: duration,
                metadata: {
                    email,
                    sessionId,
                    source,
                    hasMagicLink: !!magicLink,
                    frontendUrl
                }
            });

            res.json({
                success: true,
                message: 'Magic link created successfully!',
                data: {
                    magic_link: magicLink,
                    expires_in_minutes: 15,
                    instructions: [
                        '🔗 Click the magic link above',
                        '📝 Complete the quick setup (30 seconds)',
                        '🔄 Come back to this chat',
                        '🎉 Start tracking your AI costs!'
                    ],
                    message: 'Magic link sent! Click the link above to connect your account in 30 seconds. The link expires in 15 minutes.'
                }
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Magic link generation failed', {
                email,
                hasEmail: !!email,
                name,
                hasName: !!name,
                source,
                hasSource: !!source,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to generate magic link',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    static async completeMagicLink(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const { token, data } = req.query;

        try {
            loggingService.info('Magic link completion initiated', {
                hasToken: !!token,
                hasData: !!data,
                tokenPreview: token ? token.toString().substring(0, 10) + '...' : 'none',
                requestId: req.headers['x-request-id'] as string
            });

            if (!token || !data) {
                loggingService.warn('Magic link completion failed - invalid magic link format', {
                    hasToken: !!token,
                    hasData: !!data,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Invalid magic link format.'
                });
                return;
            }

            loggingService.info('Magic link completion processing started', {
                hasToken: !!token,
                hasData: !!data,
                tokenPreview: token ? token.toString().substring(0, 10) + '...' : 'none',
                requestId: req.headers['x-request-id'] as string
            });

            // Decode and parse the magic link data
            let magicLinkData;
            try {
                const decodedData = Buffer.from(data as string, 'base64').toString('utf-8');
                magicLinkData = JSON.parse(decodedData);
            } catch (parseError: any) {
                loggingService.error('Magic link completion failed - data parsing error', {
                    hasToken: !!token,
                    hasData: !!data,
                    tokenPreview: token ? token.toString().substring(0, 10) + '...' : 'none',
                    error: parseError.message || 'Unknown parse error',
                    stack: parseError.stack,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Invalid magic link format.'
                });
                return;
            }

            // Check if expired (handle both old and new format)
            let isExpired = false;
            if (magicLinkData.x) {
                // New format with Unix timestamp
                isExpired = Date.now() / 1000 > magicLinkData.x;
            } else if (magicLinkData.expiresAt) {
                // Old format with ISO string
                isExpired = new Date() > new Date(magicLinkData.expiresAt);
            }
            
            if (isExpired) {
                loggingService.warn('Magic link completion failed - link expired', {
                    hasToken: !!token,
                    hasData: !!data,
                    tokenPreview: token ? token.toString().substring(0, 10) + '...' : 'none',
                    isExpired,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Magic link has expired. Please generate a new one.'
                });
                return;
            }

            // Extract data (handle both old and new field names)
            const email = magicLinkData.e || magicLinkData.email;
            const name = magicLinkData.n || magicLinkData.name;
            const source = magicLinkData.s || magicLinkData.source;

            loggingService.info('Processing onboarding completion', { 
                token: token.toString().substring(0, 10) + '...', 
                email,
                name,
                hasName: !!name,
                source,
                hasSource: !!source,
                requestId: req.headers['x-request-id'] as string
            });

            // Parallel database operations with optimized queries
            const [user, existingChatGPTIntegration]: [any, any] = await Promise.all([
                User.findOne({ email }).lean(),
                User.findOne({ 
                    email, 
                    'dashboardApiKeys.name': { $regex: /chatgpt/i } 
                }).select('_id').lean()
            ]);
            
            let isNewUser = false;
            let cleanedUser = user;

            if (!user) {
                // Check if already has ChatGPT integration to avoid duplicates
                if (existingChatGPTIntegration) {
                    this.queueSmartLog('info', 'User already has ChatGPT integration', { email });
                    // Return early with existing integration response
                    const alreadyConnectedHtml = this.generateAlreadyConnectedHtml(name || email.split('@')[0]);
                    res.setHeader('Content-Type', 'text/html');
                    res.send(alreadyConnectedHtml);
                    return;
                }

                // Parallel generation of user data
                const [userId, keyId, keySecret, tempPassword] = await Promise.all([
                    Promise.resolve(new mongoose.Types.ObjectId().toString()),
                    Promise.resolve(crypto.randomBytes(16).toString('hex')),
                    Promise.resolve(crypto.randomBytes(16).toString('hex')),
                    Promise.resolve(crypto.randomBytes(8).toString('hex').toUpperCase())
                ]);

                const apiKey = `ck_${userId}_${keyId}_${keySecret}`;
                const maskedKey = `ck_${keyId.substring(0, 4)}...${keyId.substring(-4)}`;

                // Create new user with optimized structure
                const newUser = new User({
                    _id: userId,
                    email,
                    name: name || email.split('@')[0],
                    password: tempPassword,
                    emailVerified: true,
                    preferences: {
                        emailAlerts: true,
                        alertThreshold: 80,
                        optimizationSuggestions: true
                    },
                    dashboardApiKeys: [{
                        name: `${source.charAt(0).toUpperCase() + source.slice(1)} Integration`,
                        keyId,
                        encryptedKey: apiKey,
                        maskedKey,
                        permissions: ['read', 'write'],
                        createdAt: new Date(),
                    }]
                });

                // Save user first
                const savedUser = await newUser.save();

                // Create default free subscription for new user
                const { SubscriptionService } = await import('../services/subscription.service');
                const subscription = await SubscriptionService.createDefaultSubscription(userId);
                
                // Update user with subscriptionId
                savedUser.subscriptionId = subscription._id as any;
                await savedUser.save();

                // Create default workspace for the user
                const { WorkspaceService } = await import('../services/workspace.service');
                const workspace = await WorkspaceService.createDefaultWorkspace(
                    userId,
                    savedUser.name || email.split('@')[0]
                );

                // Update user with workspace
                savedUser.workspaceId = workspace._id;
                savedUser.workspaceMemberships = [{
                    workspaceId: workspace._id,
                    role: 'owner',
                    joinedAt: new Date(),
                }];
                await savedUser.save();

                // Create owner team member record
                const { TeamMember } = await import('../models/TeamMember');
                await TeamMember.create({
                    userId: new mongoose.Types.ObjectId(userId),
                    workspaceId: workspace._id,
                    email: savedUser.email,
                    role: 'owner',
                    status: 'active',
                    joinedAt: new Date(),
                });

                // Create project (now that workspace exists)
                const defaultProject = await ProjectService.createProject(userId, {
                    name: `My ${source.charAt(0).toUpperCase() + source.slice(1)} Project`,
                    description: `Default project for ${source} cost tracking`,
                    budget: {
                        amount: 100,
                        period: 'monthly' as const,
                        currency: 'USD'
                    },
                    settings: {
                        requireApprovalAbove: 100,
                        enablePromptLibrary: true,
                        enableCostAllocation: true
                    }
                });

                cleanedUser = savedUser.toObject();
                isNewUser = true;

                loggingService.info('New user created via magic link with API key', { 
                    email, 
                    userId: savedUser._id.toString(), 
                    keyId,
                    hasTempPassword: !!tempPassword,
                    requestId: req.headers['x-request-id'] as string
                });
                
                // Queue welcome email for background processing
                this.queueBackgroundOperation(async () => {
                    await this.sendWelcomeEmailWithCircuitBreaker(email, cleanedUser?.name || name || email.split('@')[0], tempPassword, source);
                });
                
                // Store the temp password to show on success page
                (cleanedUser as any).tempPasswordForDisplay = tempPassword;
                
                // API key variables are already set above, skip the generation below
            } else if (cleanedUser) {
                // User exists, check if they already have a ChatGPT integration API key
                const existingChatGPTKey = cleanedUser.dashboardApiKeys?.find((key: any) => 
                    key && key.name && key.name.toLowerCase().includes('chatgpt')
                );
                
                if (existingChatGPTKey) {
                    loggingService.info('User already has ChatGPT API key', { 
                        email, 
                        userId: cleanedUser._id.toString(),
                        requestId: req.headers['x-request-id'] as string
                    });
                    // Return existing setup instead of creating duplicate
                    const alreadyConnectedNonce = crypto.randomBytes(16).toString('base64');
                    const successHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Cost Katana - Already Connected!</title>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <meta http-equiv="Content-Security-Policy" content="script-src 'self' 'nonce-${alreadyConnectedNonce}'; object-src 'none';">
                        <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f8fafc; }
                            .success-card { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center; }
                            .success-icon { font-size: 48px; margin-bottom: 20px; }
                            h1 { color: #059669; margin: 0 0 10px 0; }
                            .subtitle { color: #6b7280; margin-bottom: 30px; }
                            .api-key { background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; padding: 15px; font-family: 'Monaco', monospace; font-size: 12px; word-break: break-all; margin: 20px 0; }
                            .auto-return { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 15px; margin-top: 20px; font-size: 14px; }
                        </style>
                    </head>
                    <body>
                        <div class="success-card">
                            <div class="success-icon">✅</div>
                            <h1>Already Connected to Cost Katana!</h1>
                            <p class="subtitle">Welcome back ${cleanedUser.name}! Your ChatGPT integration is already active.</p>
                            
                            <div class="auto-return">
                                <strong>🔄 Returning to ChatGPT...</strong><br>
                                Your account is ready to track AI costs! This window will close automatically.
                            </div>
                        </div>
                        
                        <script nonce="${alreadyConnectedNonce}">
                            document.addEventListener('DOMContentLoaded', function() {
                                setTimeout(() => {
                                    if (window.opener) {
                                        window.close();
                                    }
                                }, 3000);
                            });
                        </script>
                    </body>
                    </html>
                    `;

                    res.setHeader('Content-Type', 'text/html');
                    res.send(successHtml);
                    return;
                }
            }

            // Generate API key for ChatGPT integration with robust error handling (only for existing users)
            let apiKey, keyId, maskedKey;
            
            // Only generate API key if user already exists (new users already have one)
            if (!isNewUser && cleanedUser) {
                // Convert lean user to full user for API key generation
                const fullUser = await User.findById(cleanedUser._id);
                if (!fullUser) {
                    throw new Error('User not found during API key generation');
                }

                // Generate unique keyId first to avoid conflicts
                keyId = crypto.randomBytes(16).toString('hex');
                loggingService.info('Generated initial keyId for existing user', { 
                    keyId,
                    email,
                    userId: fullUser._id.toString(),
                    requestId: req.headers['x-request-id'] as string
                });
                
                try {
                    // Try using AuthService first
                    const { AuthService } = await import('../services/auth.service');
                    loggingService.info('About to call AuthService.generateDashboardApiKey', {
                        email,
                        userId: fullUser._id.toString(),
                        requestId: req.headers['x-request-id'] as string
                    });
                    
                    const result = AuthService.generateDashboardApiKey(
                        fullUser as any, 
                        `${source.charAt(0).toUpperCase() + source.slice(1)} Integration`,
                        ['read', 'write']
                    );
                    
                    loggingService.info('AuthService result received', {
                        email,
                        userId: fullUser._id.toString(),
                        hasResult: !!result,
                        hasKeyId: !!(result && result.keyId),
                        hasApiKey: !!(result && result.apiKey),
                        hasMaskedKey: !!(result && result.maskedKey),
                        requestId: req.headers['x-request-id'] as string
                    });
                    
                    // Validate the result
                    if (result && result.keyId && result.apiKey && result.maskedKey) {
                        apiKey = result.apiKey;
                        keyId = result.keyId;
                        maskedKey = result.maskedKey;
                        loggingService.info('Using AuthService generated keyId', { 
                            keyId,
                            email,
                            userId: fullUser._id.toString(),
                            requestId: req.headers['x-request-id'] as string
                        });
                    } else {
                        loggingService.error('AuthService returned invalid data', {
                            email,
                            userId: fullUser._id.toString(),
                            result,
                            requestId: req.headers['x-request-id'] as string
                        });
                        throw new Error('AuthService returned invalid API key data');
                    }

                    // Encrypt the API key for storage
                    const { encrypt } = await import('../utils/helpers');
                    const { encrypted, iv, authTag } = encrypt(apiKey);
                    const encryptedKey = `${iv}:${authTag}:${encrypted}`;

                    // Initialize dashboardApiKeys array if it doesn't exist
                    if (!fullUser.dashboardApiKeys) {
                        fullUser.dashboardApiKeys = [];
                    }

                    const newApiKey = {
                        name: `${source.charAt(0).toUpperCase() + source.slice(1)} Integration`,
                        keyId,
                        encryptedKey,
                        maskedKey,
                        permissions: ['read', 'write'],
                        createdAt: new Date(),
                    };

                    fullUser.dashboardApiKeys.push(newApiKey);
                    
                } catch (keyGenError: any) {
                    loggingService.error('Error with AuthService, using fallback API key generation', {
                        email,
                        userId: fullUser._id.toString(),
                        error: keyGenError.message || 'Unknown key generation error',
                        stack: keyGenError.stack,
                        requestId: req.headers['x-request-id'] as string
                    });
                    
                    // Fallback to simple but robust API key generation
                    const userId = fullUser._id ? fullUser._id.toString() : 'unknown';
                    const keySecret = crypto.randomBytes(16).toString('hex');
                    apiKey = `ck_${userId}_${keyId}_${keySecret}`;
                    maskedKey = `ck_${keyId.substring(0, 4)}...${keyId.substring(-4)}`;
                    
                    loggingService.info('Fallback API key generated', { 
                        keyId, 
                        apiKey: apiKey.substring(0, 20) + '...', 
                        maskedKey,
                        email,
                        userId: fullUser._id.toString(),
                        requestId: req.headers['x-request-id'] as string
                    });

                    // Initialize dashboardApiKeys array if it doesn't exist
                    if (!fullUser.dashboardApiKeys) {
                        fullUser.dashboardApiKeys = [];
                    }

                    const newApiKey = {
                        name: `${source.charAt(0).toUpperCase() + source.slice(1)} Integration`,
                        keyId,
                        encryptedKey: apiKey, // Store unencrypted as fallback
                        maskedKey,
                        permissions: ['read', 'write'],
                        createdAt: new Date(),
                    };

                    loggingService.info('About to push API key to user', { 
                        keyId: newApiKey.keyId, 
                        name: newApiKey.name,
                        email,
                        userId: fullUser._id.toString(),
                        requestId: req.headers['x-request-id'] as string
                    });
                    fullUser.dashboardApiKeys.push(newApiKey);
                    loggingService.info('API key pushed successfully', {
                        email,
                        userId: fullUser._id.toString(),
                        requestId: req.headers['x-request-id'] as string
                    });
                }

                // Save user (only if it's an existing user with new API key)
                await fullUser.save();
                cleanedUser = fullUser.toObject(); // Update cleanedUser with saved data
            }

            if (!cleanedUser) {
                throw new Error('User data not available for project creation');
            }

            // Create default project (only if not already created for new users)
            let defaultProject;
            if (isNewUser) {
                // Project already created in parallel for new users
                defaultProject = { _id: 'already_created' };
            } else {
                defaultProject = await ProjectService.createProject(cleanedUser._id.toString(), {
                    name: `My ${source.charAt(0).toUpperCase() + source.slice(1)} Project`,
                    description: `Default project for ${source} cost tracking`,
                    budget: {
                        amount: 100,
                        period: 'monthly' as const,
                        currency: 'USD'
                    },
                    settings: {
                        requireApprovalAbove: 100,
                        enablePromptLibrary: true,
                        enableCostAllocation: true
                    }
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('Magic link onboarding completed successfully', { 
                email, 
                userId: cleanedUser._id.toString(), 
                projectId: defaultProject._id,
                isNewUser,
                duration,
                source,
                hasApiKey: !!(apiKey || (cleanedUser.dashboardApiKeys && cleanedUser.dashboardApiKeys.length > 0)),
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'magic_link_onboarding_completed',
                category: 'onboarding_operations',
                value: duration,
                metadata: {
                    email,
                    userId: cleanedUser._id.toString(),
                    projectId: defaultProject._id,
                    isNewUser,
                    source,
                    hasApiKey: !!(apiKey || (cleanedUser.dashboardApiKeys && cleanedUser.dashboardApiKeys.length > 0))
                }
            });

            // Create JWT token for authentication
            const jwtToken = jwt.sign(
                { 
                    userId: cleanedUser._id.toString(), 
                    email: cleanedUser.email,
                    sessionId: magicLinkData.sid || magicLinkData.sessionId
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            // Success HTML response with CSP-compliant external script
            const scriptNonce = crypto.randomBytes(16).toString('base64');
            const tempPasswordDisplay = (cleanedUser as any).tempPasswordForDisplay;
            const loginUrl = `${process.env.FRONTEND_URL?.replace(/\/$/, '') || 'http://localhost:3000'}/login`;
            
            const successHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Cost Katana - Connected Successfully!</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <meta http-equiv="Content-Security-Policy" content="script-src 'self' 'nonce-${scriptNonce}'; object-src 'none';">
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f8fafc; }
                    .success-card { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center; }
                    .success-icon { font-size: 48px; margin-bottom: 20px; }
                    h1 { color: #059669; margin: 0 0 10px 0; }
                    .subtitle { color: #6b7280; margin-bottom: 30px; }
                    .credentials-box { background: #f0f9ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: left; }
                    .password { font-family: Monaco, monospace; font-size: 16px; font-weight: bold; color: #059669; background: white; padding: 10px; border-radius: 4px; text-align: center; margin: 10px 0; letter-spacing: 1px; border: 1px solid #d1d5db; }
                    .api-key { background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; padding: 15px; font-family: 'Monaco', monospace; font-size: 12px; word-break: break-all; margin: 20px 0; }
                    .copy-btn { background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; margin: 5px 5px 0 0; }
                    .copy-btn:hover { background: #2563eb; }
                    .copy-btn.copied { background: #059669; }
                    .login-btn { display: inline-block; background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 15px 0; }
                    .login-btn:hover { background: #047857; }
                    .auto-return { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 15px; margin-top: 20px; font-size: 14px; }
                    .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px; margin: 15px 0; font-size: 14px; }
                </style>
            </head>
            <body>
                <div class="success-card">
                    <div class="success-icon">🎉</div>
                    <h1>Successfully Connected to Cost Katana!</h1>
                    <p class="subtitle">Welcome ${cleanedUser.name}! Your account is now set up for AI cost tracking.</p>
                    
                    ${isNewUser && tempPasswordDisplay ? `
                    <div class="credentials-box">
                        <h3>🔐 Your Login Credentials</h3>
                        <p><strong>Email:</strong> ${cleanedUser.email}</p>
                        <p><strong>Temporary Password:</strong></p>
                        <div class="password" id="password">${tempPasswordDisplay}</div>
                        <button class="copy-btn" id="copyPasswordBtn">Copy Password</button>
                        <div style="text-align: center; margin-top: 15px;">
                            <a href="${loginUrl}" class="login-btn" target="_blank">Login to Dashboard</a>
                        </div>
                    </div>
                    
                    <div class="warning">
                        <strong>⚠️ Important:</strong> Save these credentials! We've also sent them to your email (${cleanedUser.email}). You can change your password after logging in.
                    </div>
                    ` : ''}
                    
                    <div class="api-key">
                        <strong>Your ${source} API Integration:</strong><br>
                        <span id="apiKey">${maskedKey || 'Generated successfully'}</span>
                        <br><button class="copy-btn" id="copyApiBtn">Copy API Key</button>
                    </div>
                    
                    <div class="auto-return">
                        <strong>🔄 Returning to ${source}...</strong><br>
                        Your account is ready to track AI costs! This window will close automatically in 15 seconds.
                    </div>
                </div>
                
                <script nonce="${scriptNonce}">
                    // Store auth data for potential use
                    const authData = {
                        token: '${jwtToken}',
                        userId: '${user._id.toString()}',
                        email: '${user.email}',
                        projectId: '${defaultProject._id}'
                    };
                    
                    // Add event listeners for copy buttons
                    document.addEventListener('DOMContentLoaded', function() {
                        // API Key copy button
                        const copyApiBtn = document.getElementById('copyApiBtn');
                        const apiKeyElement = document.getElementById('apiKey');
                        
                        if (copyApiBtn && apiKeyElement) {
                            copyApiBtn.addEventListener('click', function() {
                                const apiKeyText = apiKeyElement.textContent || 'API Key Generated';
                                copyToClipboard(apiKeyText, 'copyApiBtn', 'Copy API Key');
                            });
                        }
                        
                        // Password copy button (only for new users)
                        const copyPasswordBtn = document.getElementById('copyPasswordBtn');
                        const passwordElement = document.getElementById('password');
                        
                        if (copyPasswordBtn && passwordElement) {
                            copyPasswordBtn.addEventListener('click', function() {
                                const passwordText = passwordElement.textContent || '';
                                copyToClipboard(passwordText, 'copyPasswordBtn', 'Copy Password');
                            });
                        }
                        
                        function copyToClipboard(text, buttonId, originalText) {
                            // Try modern clipboard API first
                            if (navigator.clipboard && window.isSecureContext) {
                                navigator.clipboard.writeText(text).then(() => {
                                    showCopySuccess(buttonId, originalText);
                                }).catch(() => {
                                    fallbackCopy(text, buttonId, originalText);
                                });
                            } else {
                                fallbackCopy(text, buttonId, originalText);
                            }
                        }
                        
                        function showCopySuccess(buttonId, originalText) {
                            const btn = document.getElementById(buttonId);
                            if (btn) {
                                btn.textContent = 'Copied!';
                                btn.classList.add('copied');
                                setTimeout(() => {
                                    btn.textContent = originalText;
                                    btn.classList.remove('copied');
                                }, 2000);
                            }
                        }
                        
                        function fallbackCopy(text, buttonId, originalText) {
                            // Fallback for older browsers
                            const textArea = document.createElement('textarea');
                            textArea.value = text;
                            textArea.style.position = 'fixed';
                            textArea.style.left = '-999999px';
                            textArea.style.top = '-999999px';
                            document.body.appendChild(textArea);
                            textArea.focus();
                            textArea.select();
                            
                            try {
                                document.execCommand('copy');
                                showCopySuccess(buttonId, originalText);
                            } catch (err) {
                                console.error('Copy failed:', err);
                                alert('Copy failed. Please manually copy: ' + text);
                            }
                            
                            document.body.removeChild(textArea);
                        }
                        
                        // Auto-close window after 15 seconds
                        setTimeout(() => {
                            if (window.opener) {
                                window.close();
                            }
                        }, 15000);
                    });
                </script>
            </body>
            </html>
            `;

            res.setHeader('Content-Type', 'text/html');
            res.send(successHtml);

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Magic link onboarding completion failed', {
                hasToken: !!token,
                hasData: !!data,
                tokenPreview: token ? token.toString().substring(0, 10) + '...' : 'none',
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to complete onboarding',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    static async verifyMagicLink(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const { token } = req.params;

        try {
            loggingService.info('Magic link verification initiated', {
                hasToken: !!token,
                tokenPreview: token ? token.substring(0, 10) + '...' : 'none',
                requestId: req.headers['x-request-id'] as string
            });

            if (!token) {
                loggingService.warn('Magic link verification failed - token is required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Token is required'
                });
                return;
            }

            loggingService.info('Magic link verification processing started', {
                hasToken: !!token,
                tokenPreview: token ? token.substring(0, 10) + '...' : 'none',
                requestId: req.headers['x-request-id'] as string
            });

            // For now, return success if token exists
            // In production, you'd verify against stored tokens
            const duration = Date.now() - startTime;

            loggingService.info('Magic link verified successfully', {
                hasToken: !!token,
                tokenPreview: token ? token.substring(0, 10) + '...' : 'none',
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'magic_link_verified',
                category: 'onboarding_operations',
                value: duration,
                metadata: {
                    hasToken: !!token,
                    tokenPreview: token ? token.substring(0, 10) + '...' : 'none'
                }
            });

            res.json({
                success: true,
                message: 'Magic link verified successfully'
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Magic link verification failed', {
                hasToken: !!token,
                tokenPreview: token ? token.substring(0, 10) + '...' : 'none',
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to verify magic link',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Queue background operation
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    /**
     * Start background processor
     */
    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', { 
                            error: error instanceof Error ? error.message : String(error) 
                        });
                    }
                }
            }
        }, 1000); // Process queue every second
    }

    /**
     * Send welcome email with circuit breaker protection
     */
    private static async sendWelcomeEmailWithCircuitBreaker(
        email: string, 
        name: string, 
        tempPassword: string, 
        source: string
    ): Promise<void> {
        // Check if circuit breaker is open
        if (this.isEmailCircuitBreakerOpen()) {
            loggingService.warn('Email circuit breaker is open, skipping email send');
            return;
        }

        try {
            const { EmailService } = await import('../services/email.service');
            const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '') || 'http://localhost:3000';
            const loginUrl = `${frontendUrl}/login`;
            
            await EmailService.sendEmail({
                to: email,
                subject: '🎉 Welcome to Cost Katana! Your Account is Ready',
                html: this.generateWelcomeEmailHtml(name, email, tempPassword, source, loginUrl)
            });

            // Reset failure count on success
            this.emailFailureCount = 0;
            this.queueSmartLog('info', 'Welcome email sent successfully', { email });
        } catch (error) {
            this.recordEmailFailure();
            this.queueSmartLog('error', 'Failed to send welcome email', { 
                email, 
                error: error instanceof Error ? error.message : String(error) 
            });
        }
    }

    /**
     * Check if email circuit breaker is open
     */
    private static isEmailCircuitBreakerOpen(): boolean {
        if (this.emailFailureCount >= this.MAX_EMAIL_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastEmailFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.emailFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    /**
     * Record email failure
     */
    private static recordEmailFailure(): void {
        this.emailFailureCount++;
        this.lastEmailFailureTime = Date.now();
    }

    /**
     * Generate welcome email HTML
     */
    private static generateWelcomeEmailHtml(
        name: string, 
        email: string, 
        tempPassword: string, 
        source: string, 
        loginUrl: string
    ): string {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { padding: 30px 20px; background: #f8fafc; }
                .credentials-box { background: white; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; }
                .password { font-family: Monaco, monospace; font-size: 18px; font-weight: bold; color: #059669; background: #f0f9ff; padding: 10px; border-radius: 4px; text-align: center; margin: 10px 0; letter-spacing: 2px; }
                .login-btn { display: inline-block; background: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
                .important { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 4px; padding: 15px; margin: 20px 0; }
                .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🎉 Welcome to Cost Katana!</h1>
                <p>Your AI cost tracking account is ready</p>
            </div>
            <div class="content">
                <h2>Hi ${name}!</h2>
                <p>Great news! Your Cost Katana account has been successfully created via magic link from ${source}.</p>
                
                <div class="credentials-box">
                    <h3>🔐 Your Login Credentials</h3>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Temporary Password:</strong></p>
                    <div class="password">${tempPassword}</div>
                    <p style="font-size: 14px; color: #6b7280;">You can change this password after logging in</p>
                </div>

                <div style="text-align: center;">
                    <a href="${loginUrl}" class="login-btn">Login to Cost Katana Dashboard</a>
                </div>

                <div class="important">
                    <strong>⚠️ Important:</strong>
                    <ul>
                        <li>Save this email - your temporary password is: <strong>${tempPassword}</strong></li>
                        <li>Your ${source} integration is already configured and ready to use</li>
                        <li>Change your password after first login for security</li>
                    </ul>
                </div>

                <h3>🚀 What's Next?</h3>
                <ol>
                    <li>Login to your dashboard using the credentials above</li>
                    <li>Go back to ${source} and start tracking your AI costs</li>
                    <li>Set up budget alerts and optimization preferences</li>
                    <li>View your detailed cost analytics and insights</li>
                </ol>

                <p>Need help? Just reply to this email and we'll assist you!</p>
                <p>Happy cost tracking! 📊</p>
            </div>
            <div class="footer">
                <p>© ${new Date().getFullYear()} Cost Katana. All rights reserved.</p>
                <p>This email was sent because you connected via magic link from ${source}</p>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Generate already connected HTML
     */
    private static generateAlreadyConnectedHtml(name: string): string {
        const nonce = crypto.randomBytes(16).toString('base64');
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Cost Katana - Already Connected!</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta http-equiv="Content-Security-Policy" content="script-src 'self' 'nonce-${nonce}'; object-src 'none';">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f8fafc; }
                .success-card { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center; }
                .success-icon { font-size: 48px; margin-bottom: 20px; }
                h1 { color: #059669; margin: 0 0 10px 0; }
                .subtitle { color: #6b7280; margin-bottom: 30px; }
                .auto-return { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 15px; margin-top: 20px; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="success-card">
                <div class="success-icon">✅</div>
                <h1>Already Connected to Cost Katana!</h1>
                <p class="subtitle">Welcome back ${name}! Your ChatGPT integration is already active.</p>
                
                <div class="auto-return">
                    <strong>🔄 Returning to ChatGPT...</strong><br>
                    Your account is ready to track AI costs! This window will close automatically.
                </div>
            </div>
            
            <script nonce="${nonce}">
                document.addEventListener('DOMContentLoaded', function() {
                    setTimeout(() => {
                        if (window.opener) {
                            window.close();
                        }
                    }, 3000);
                });
            </script>
        </body>
        </html>
        `;
    }

    /**
     * Queue smart log entry
     */
    private static queueSmartLog(level: string, message: string, data: any): void {
        this.logBatch.push({ level, message, data, timestamp: Date.now() });
        
        // Process batch if it gets too large or set timer
        if (this.logBatch.length >= 10) {
            this.processLogBatch();
        } else if (!this.logBatchTimer) {
            this.logBatchTimer = setTimeout(() => {
                this.processLogBatch();
            }, 5000); // Process batch every 5 seconds
        }
    }

    /**
     * Process log batch
     */
    private static processLogBatch(): void {
        if (this.logBatch.length === 0) return;

        const batch = [...this.logBatch];
        this.logBatch = [];
        
        if (this.logBatchTimer) {
            clearTimeout(this.logBatchTimer);
            this.logBatchTimer = undefined;
        }

        // Process logs in background
        setImmediate(() => {
            batch.forEach(log => {
                switch (log.level) {
                    case 'info':
                        loggingService.info(log.message, log.data);
                        break;
                    case 'warn':
                        loggingService.warn(log.message, log.data);
                        break;
                    case 'error':
                        loggingService.error(log.message, log.data);
                        break;
                    default:
                        loggingService.info(log.message, log.data);
                }
            });
        });
    }
} 