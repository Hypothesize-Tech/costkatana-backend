import { Request, Response } from 'express';
import { User } from '../models/User';
import { ProjectService } from '../services/project.service';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

export class OnboardingController {
    static async generateMagicLink(req: Request, res: Response): Promise<void> {
        try {
            const { email, name, source = 'ChatGPT' } = req.body;

            if (!email) {
                res.status(400).json({
                    success: false,
                    error: 'Email is required'
                });
                return;
            }

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

            logger.info('Magic link generated', { email, sessionId, source });

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

        } catch (error) {
            logger.error('Generate magic link error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate magic link',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    static async completeMagicLink(req: Request, res: Response): Promise<void> {
        try {
            const { token, data } = req.query;

            if (!token || !data) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid magic link format.'
                });
                return;
            }

            // Decode and parse the magic link data
            let magicLinkData;
            try {
                const decodedData = Buffer.from(data as string, 'base64').toString('utf-8');
                magicLinkData = JSON.parse(decodedData);
            } catch (parseError) {
                logger.error('Failed to parse magic link data:', parseError);
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
            logger.info('Processing onboarding completion', { token: token.toString().substring(0, 10) + '...', email });

            // Find existing user and clean up any corrupted data
            let user = await User.findOne({ email });
            let isNewUser = false;

            // Clean up any corrupted data for existing users
            if (user && user.dashboardApiKeys && user.dashboardApiKeys.length > 0) {
                const cleanApiKeys = user.dashboardApiKeys.filter(key => 
                    key && key.keyId && key.keyId !== null && key.keyId !== undefined
                );
                
                if (cleanApiKeys.length !== user.dashboardApiKeys.length) {
                    logger.info('Cleaning corrupted API keys for user', { 
                        email, 
                        originalCount: user.dashboardApiKeys.length, 
                        cleanCount: cleanApiKeys.length 
                    });
                    
                    // Update user with cleaned data
                    await User.updateOne(
                        { email },
                        { $set: { dashboardApiKeys: cleanApiKeys } }
                    );
                    
                    // Refresh user data
                    user = await User.findOne({ email });
                }
            }

            if (!user) {
                // Generate API key FIRST before creating user
                const userId = new mongoose.Types.ObjectId().toString();
                const keyId = crypto.randomBytes(16).toString('hex');
                const keySecret = crypto.randomBytes(16).toString('hex');
                const apiKey = `ck_${userId}_${keyId}_${keySecret}`;
                const maskedKey = `ck_${keyId.substring(0, 4)}...${keyId.substring(-4)}`;

                // Generate a readable temporary password that users can actually use
                const tempPassword = crypto.randomBytes(8).toString('hex').toUpperCase(); // Shorter, readable password

                // Create new user with API key already included
                user = new User({
                    _id: userId,
                    email,
                    name: name || email.split('@')[0], // Use provided name or email prefix as default
                    password: tempPassword,
                    emailVerified: true, // Auto-verify via magic link
                    preferences: {
                        emailAlerts: true,
                        alertThreshold: 80,
                        weeklyReports: true,
                        optimizationSuggestions: true
                    },
                    dashboardApiKeys: [{
                        name: `${source.charAt(0).toUpperCase() + source.slice(1)} Integration`,
                        keyId,
                        encryptedKey: apiKey, // Store unencrypted for simplicity
                        maskedKey,
                        permissions: ['read', 'write'],
                        createdAt: new Date(),
                    }]
                });
                await user.save();
                isNewUser = true;
                logger.info('New user created via magic link with API key', { email, userId: user._id, keyId });
                
                // Send welcome email with login credentials
                try {
                    const { EmailService } = await import('../services/email.service');
                    const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '') || 'http://localhost:3000';
                    const loginUrl = `${frontendUrl}/login`;
                    
                    await EmailService.sendEmail({
                        to: email,
                        subject: '🎉 Welcome to Cost Katana! Your Account is Ready',
                        html: `
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
                                <h2>Hi ${user.name}!</h2>
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
                        `
                    });
                    logger.info('Welcome email sent with login credentials', { email });
                } catch (emailError) {
                    logger.error('Failed to send welcome email:', emailError);
                    // Don't fail the onboarding if email fails
                }
                
                // Store the temp password to show on success page
                (user as any).tempPasswordForDisplay = tempPassword;
                
                // API key variables are already set above, skip the generation below
            } else {
                // User exists, check if they already have a ChatGPT integration API key
                const existingChatGPTKey = user.dashboardApiKeys?.find(key => 
                    key && key.name && key.name.toLowerCase().includes('chatgpt')
                );
                
                if (existingChatGPTKey) {
                    logger.info('User already has ChatGPT API key', { email, userId: user._id });
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
                            <p class="subtitle">Welcome back ${user.name}! Your ChatGPT integration is already active.</p>
                            
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
            if (!isNewUser) {
                // Generate unique keyId first to avoid conflicts
                keyId = crypto.randomBytes(16).toString('hex');
                logger.info('Generated initial keyId:', keyId);
                
                try {
                    // Try using AuthService first
                    const { AuthService } = await import('../services/auth.service');
                    logger.info('About to call AuthService.generateDashboardApiKey');
                    
                    const result = AuthService.generateDashboardApiKey(
                        user as any, 
                        `${source.charAt(0).toUpperCase() + source.slice(1)} Integration`,
                        ['read', 'write']
                    );
                    
                    logger.info('AuthService result:', result);
                    
                    // Validate the result
                    if (result && result.keyId && result.apiKey && result.maskedKey) {
                        apiKey = result.apiKey;
                        keyId = result.keyId;
                        maskedKey = result.maskedKey;
                        logger.info('Using AuthService generated keyId:', keyId);
                    } else {
                        logger.error('AuthService returned invalid data:', result);
                        throw new Error('AuthService returned invalid API key data');
                    }

                    // Encrypt the API key for storage
                    const { encrypt } = await import('../utils/helpers');
                    const { encrypted, iv, authTag } = encrypt(apiKey);
                    const encryptedKey = `${iv}:${authTag}:${encrypted}`;

                    // Initialize dashboardApiKeys array if it doesn't exist
                    if (!user.dashboardApiKeys) {
                        user.dashboardApiKeys = [];
                    }

                    const newApiKey = {
                        name: `${source.charAt(0).toUpperCase() + source.slice(1)} Integration`,
                        keyId,
                        encryptedKey,
                        maskedKey,
                        permissions: ['read', 'write'],
                        createdAt: new Date(),
                    };

                    user.dashboardApiKeys.push(newApiKey);
                    
                } catch (keyGenError) {
                    logger.error('Error with AuthService, using fallback API key generation:', keyGenError);
                    
                    // Fallback to simple but robust API key generation
                    const userId = user._id ? user._id.toString() : 'unknown';
                    const keySecret = crypto.randomBytes(16).toString('hex');
                    apiKey = `ck_${userId}_${keyId}_${keySecret}`;
                    maskedKey = `ck_${keyId.substring(0, 4)}...${keyId.substring(-4)}`;
                    
                    logger.info('Fallback API key generated:', { keyId, apiKey: apiKey.substring(0, 20) + '...', maskedKey });

                    // Initialize dashboardApiKeys array if it doesn't exist
                    if (!user.dashboardApiKeys) {
                        user.dashboardApiKeys = [];
                    }

                    const newApiKey = {
                        name: `${source.charAt(0).toUpperCase() + source.slice(1)} Integration`,
                        keyId,
                        encryptedKey: apiKey, // Store unencrypted as fallback
                        maskedKey,
                        permissions: ['read', 'write'],
                        createdAt: new Date(),
                    };

                    logger.info('About to push API key to user:', { keyId: newApiKey.keyId, name: newApiKey.name });
                    user.dashboardApiKeys.push(newApiKey);
                    logger.info('API key pushed successfully');
                }
            }

            // Create default project
            const defaultProject = await ProjectService.createProject(user._id.toString(), {
                name: `My ${source.charAt(0).toUpperCase() + source.slice(1)} Project`,
                description: `Default project for ${source} cost tracking`,
                budget: {
                    amount: 100,
                    period: 'monthly',
                    currency: 'USD'
                },
                settings: {
                    requireApprovalAbove: 100,
                    enablePromptLibrary: true,
                    enableCostAllocation: true
                }
            });

            // Save user (only if it's an existing user with new API key)
            if (!isNewUser) {
                await user.save();
            }

            logger.info('Magic link onboarding completed', { 
                email, 
                userId: user._id, 
                projectId: defaultProject._id,
                isNewUser
            });

            // Create JWT token for authentication
            const jwtToken = jwt.sign(
                { 
                    userId: user._id, 
                    email: user.email,
                    sessionId: magicLinkData.sid || magicLinkData.sessionId
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            // Success HTML response with CSP-compliant external script
            const scriptNonce = crypto.randomBytes(16).toString('base64');
            const tempPasswordDisplay = (user as any).tempPasswordForDisplay;
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
                    <p class="subtitle">Welcome ${user.name}! Your account is now set up for AI cost tracking.</p>
                    
                    ${isNewUser && tempPasswordDisplay ? `
                    <div class="credentials-box">
                        <h3>🔐 Your Login Credentials</h3>
                        <p><strong>Email:</strong> ${user.email}</p>
                        <p><strong>Temporary Password:</strong></p>
                        <div class="password" id="password">${tempPasswordDisplay}</div>
                        <button class="copy-btn" id="copyPasswordBtn">Copy Password</button>
                        <div style="text-align: center; margin-top: 15px;">
                            <a href="${loginUrl}" class="login-btn" target="_blank">Login to Dashboard</a>
                        </div>
                    </div>
                    
                    <div class="warning">
                        <strong>⚠️ Important:</strong> Save these credentials! We've also sent them to your email (${user.email}). You can change your password after logging in.
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
                        userId: '${user._id}',
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

        } catch (error) {
            logger.error('Complete magic link onboarding error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to complete onboarding',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    static async verifyMagicLink(req: Request, res: Response): Promise<void> {
        try {
            const { token } = req.params;
            
            if (!token) {
                res.status(400).json({
                    success: false,
                    error: 'Token is required'
                });
                return;
            }

            // For now, return success if token exists
            // In production, you'd verify against stored tokens
            res.json({
                success: true,
                message: 'Magic link verified successfully'
            });

        } catch (error) {
            logger.error('Verify magic link error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to verify magic link',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
} 