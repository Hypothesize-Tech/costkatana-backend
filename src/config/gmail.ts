import { google } from 'googleapis';
import nodemailer from 'nodemailer';

const OAuth2 = google.auth.OAuth2;

const createTransporter = async () => {
    const oauth2Client = new OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI
    );

    oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    });

    await new Promise<string>((resolve, reject) => {
        oauth2Client.getAccessToken((err, token) => {
            if (err) {
                reject(err);
            } else {
                resolve(token || '');
            }
        });
    });

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            type: 'OAuth2',
            user: process.env.GMAIL_USER,
            clientId: process.env.GMAIL_CLIENT_ID,
            clientSecret: process.env.GMAIL_CLIENT_SECRET,
            refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        },
    });

    return transporter;
};

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