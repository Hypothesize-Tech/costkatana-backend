import { google } from 'googleapis';
import nodemailer from 'nodemailer';

const OAuth2 = google.auth.OAuth2;

/**
 * Creates and returns a Nodemailer transporter using Gmail OAuth2.
 * Validates credentials on startup to fail fast if misconfigured.
 */
const createTransporter = async () => {
    const oauth2Client = new OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI
    );

    oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    });

    // Validate credentials and get an access token on startup
    const accessToken = await oauth2Client.getAccessToken();
    if (!accessToken || !accessToken.token) {
        throw new Error('Failed to obtain Gmail OAuth2 access token. Please check your credentials.');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            type: 'OAuth2',
            user: process.env.GMAIL_USER_EMAIL, // Use the correct env variable for the user email
            clientId: process.env.GMAIL_CLIENT_ID,
            clientSecret: process.env.GMAIL_CLIENT_SECRET,
            refreshToken: process.env.GMAIL_REFRESH_TOKEN,
            accessToken: accessToken.token,
        },
    });

    return transporter;
};

// Export a promise that resolves to the transporter
export const gmailTransporter = createTransporter();

export const EMAIL_CONFIG = {
    from: process.env.EMAIL_FROM || 'AI Cost Optimizer <noreply@aicostoptimizer.com>',
    alertThreshold: parseFloat(process.env.EMAIL_ALERT_THRESHOLD || '100'),
    templates: {
        costAlert: {
            subject: 'Cost Alert: Your AI API usage has exceeded the threshold',
        },
        optimizationAvailable: {
            subject: 'Optimization Opportunity: Save on your AI API costs',
        },
        weeklyReport: {
            subject: 'Weekly AI Usage Report',
        },
    },
};