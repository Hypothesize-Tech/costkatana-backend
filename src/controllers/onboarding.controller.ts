import { Request, Response } from 'express';
import { User } from '../models/User';
import { ProjectService } from '../services/project.service';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

export class OnboardingController {
    /**
     * Step 1: Generate magic link for ChatGPT integration
     * Called by ChatGPT GPT when user wants to connect
     */
    static async generateMagicLink(req: Request, res: Response): Promise<void> {
        try {
            const { email, name, source = 'chatgpt' } = req.body;

            if (!email) {
                res.status(400).json({
                    success: false,
                    error: 'Email is required'
                });
                return;
            }

            // Generate magic token
            const magicToken = crypto.randomBytes(32).toString('hex');
            const sessionId = crypto.randomBytes(16).toString('hex');

            // Store magic link session (you might want to use Redis for this)
            const magicLinkData = {
                email,
                name,
                source,
                sessionId,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
            };

            // In production, store this in Redis or database
            // For now, we'll encode it in the token itself
            const encodedData = Buffer.from(JSON.stringify(magicLinkData)).toString('base64');
            
            const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, ''); // Remove trailing slash
            const magicLink = `${frontendUrl}/connect/chatgpt?token=${magicToken}&data=${encodedData}`;

            res.json({
                success: true,
                data: {
                    magic_link: magicLink,
                    session_id: sessionId,
                    expires_in: 900, // 15 minutes
                    message: `Magic link generated for ${email}. Valid for 15 minutes.`
                }
            });

            logger.info('Magic link generated', { email, source, sessionId });
        } catch (error: any) {
            logger.error('Generate magic link error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate magic link',
                message: error.message
            });
        }
    }

    /**
     * Step 2: Handle magic link click - Complete onboarding
     * User clicks magic link from ChatGPT and gets redirected here
     */
    static async completeMagicLinkOnboarding(req: Request, res: Response): Promise<void> {
        try {
            const { token, data } = req.query;

            if (!token || !data) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid magic link. Please generate a new one.'
                });
                return;
            }

            // Decode magic link data
            let magicLinkData;
            try {
                magicLinkData = JSON.parse(Buffer.from(data as string, 'base64').toString());
            } catch {
                res.status(400).json({
                    success: false,
                    error: 'Invalid magic link format.'
                });
                return;
            }

            // Check if expired
            if (new Date() > new Date(magicLinkData.expiresAt)) {
                res.status(400).json({
                    success: false,
                    error: 'Magic link has expired. Please generate a new one.'
                });
                return;
            }

            const { email, name, source } = magicLinkData;

            // Find or create user
            let user = await User.findOne({ email });
            let isNewUser = false;

            if (!user) {
                // Create new user with temporary password
                const tempPassword = crypto.randomBytes(16).toString('hex');
                user = new User({
                    email,
                    name: name || email.split('@')[0], // Use provided name or email prefix as default
                    password: tempPassword,
                    emailVerified: true, // Auto-verify via magic link
                    preferences: {
                        emailAlerts: true,
                        alertThreshold: 80,
                        weeklyReports: true,
                        optimizationSuggestions: true
                    }
                });
                await user.save();
                isNewUser = true;
                logger.info('New user created via magic link', { email, userId: user._id });
            }

            // Generate API key for ChatGPT integration
            const randomSuffix = crypto.randomBytes(16).toString('hex');
            const apiKey = `ck_user_${user._id}_${randomSuffix}`;

            // Initialize apiKeys array if it doesn't exist
            if (!user.apiKeys) {
                user.apiKeys = [];
            }

            const newApiKey = {
                id: crypto.randomBytes(8).toString('hex'),
                name: `${source.charAt(0).toUpperCase() + source.slice(1)} Integration`,
                key: apiKey,
                created: new Date(),
                isActive: true
            };

            user.apiKeys.push(newApiKey);

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
                    enablePromptLibrary: true,
                    enableCostAllocation: true
                },
                tags: [source, 'auto-created']
            });

            await user.save();

            // Generate JWT for immediate login
            // Generate JWT for future session management
            jwt.sign(
                { id: user._id, email: user.email },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            // Return success page with embedded JavaScript to communicate back to ChatGPT
            const successHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Cost Katana - Connected Successfully!</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f8fafc; }
                    .success-card { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center; }
                    .success-icon { font-size: 48px; margin-bottom: 20px; }
                    h1 { color: #059669; margin: 0 0 10px 0; }
                    .subtitle { color: #6b7280; margin-bottom: 30px; }
                    .api-key { background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; padding: 15px; font-family: 'Monaco', monospace; font-size: 12px; word-break: break-all; margin: 20px 0; }
                    .copy-btn { background: #059669; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; margin-top: 10px; }
                    .copy-btn:hover { background: #047857; }
                    .next-steps { text-align: left; margin-top: 30px; }
                    .step { margin: 15px 0; padding: 15px; background: #f8fafc; border-left: 4px solid #059669; }
                    .auto-return { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 15px; margin-top: 20px; font-size: 14px; }
                </style>
            </head>
            <body>
                <div class="success-card">
                    <div class="success-icon">🎉</div>
                    <h1>Successfully Connected to Cost Katana!</h1>
                    <p class="subtitle">${isNewUser ? 'Welcome to Cost Katana!' : 'Welcome back!'} Your ${source} integration is ready.</p>
                    
                    <div class="next-steps">
                        <h3>✅ What's been set up for you:</h3>
                        
                        <div class="step">
                            <strong>🔑 API Key Generated</strong><br>
                            <div class="api-key" id="apiKey">${apiKey}</div>
                            <button class="copy-btn" onclick="copyApiKey()">Copy API Key</button>
                        </div>
                        
                        <div class="step">
                            <strong>📁 Default Project Created</strong><br>
                            "${defaultProject.name}" with $100 monthly budget
                        </div>
                        
                        <div class="step">
                            <strong>👤 Account Ready</strong><br>
                            ${isNewUser ? 'New account created' : 'Existing account connected'} for ${email}
                        </div>
                    </div>
                    
                    <div class="auto-return">
                        <strong>🔄 Returning to ${source.charAt(0).toUpperCase() + source.slice(1)}...</strong><br>
                        You can now start tracking your AI costs! This window will close automatically.
                    </div>
                </div>
                
                <script>
                    function copyApiKey() {
                        const apiKey = document.getElementById('apiKey').textContent;
                        navigator.clipboard.writeText(apiKey);
                        alert('API key copied to clipboard!');
                    }
                    
                    // Auto-close after 5 seconds if opened in popup
                    setTimeout(() => {
                        if (window.opener) {
                            window.close();
                        }
                    }, 5000);
                    
                    // Store success data for parent window communication
                    if (window.opener) {
                        window.opener.postMessage({
                            type: 'COST_KATANA_CONNECTED',
                            data: {
                                apiKey: '${apiKey}',
                                projectId: '${defaultProject._id}',
                                projectName: '${defaultProject.name}',
                                userId: '${user._id}'
                            }
                        }, '*');
                    }
                </script>
            </body>
            </html>
            `;

            res.setHeader('Content-Type', 'text/html');
            res.send(successHtml);

            logger.info('Magic link onboarding completed', {
                userId: user._id,
                email,
                source,
                isNewUser,
                projectId: defaultProject._id
            });

        } catch (error: any) {
            logger.error('Complete magic link onboarding error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to complete onboarding',
                message: error.message
            });
        }
    }

    /**
     * Generate QR code for mobile onboarding
     */
    static async generateQRCode(_req: Request, res: Response): Promise<void> {
        try {
            const sessionId = crypto.randomBytes(16).toString('hex');
            const qrData = {
                sessionId,
                url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/connect/mobile?session=${sessionId}`,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
            };

            res.json({
                success: true,
                data: {
                    qr_code_url: qrData.url,
                    session_id: sessionId,
                    display_code: sessionId.substring(0, 8).toUpperCase(),
                    expires_in: 600,
                    message: 'Scan QR code or enter the 8-digit code on costkatana.com/connect'
                }
            });
        } catch (error: any) {
            logger.error('Generate QR code error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate QR code',
                message: error.message
            });
        }
    }

    /**
     * Check onboarding status for ChatGPT polling
     */
    static async checkOnboardingStatus(_req: Request, res: Response): Promise<void> {
        try {
            // const { sessionId } = req.params; // TODO: Implement session status checking

            // In production, check Redis/database for session status
            // For now, return pending (implement your session storage)
            
            res.json({
                success: true,
                data: {
                    status: 'pending', // pending, completed, expired
                    message: 'Waiting for user to complete onboarding...'
                }
            });
        } catch (error: any) {
            logger.error('Check onboarding status error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to check status',
                message: error.message
            });
        }
    }
} 