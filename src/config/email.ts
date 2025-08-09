import nodemailer from 'nodemailer';

/**
 * Creates and returns a Nodemailer transporter using SMTP.
 * Validates credentials on startup to fail fast if misconfigured.
 */
const createTransporter = async () => {
    // Create transporter with SMTP configuration
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.FROM_EMAIL,
            pass: process.env.SMTP_PASS
        },
        tls: {
            // do not fail on invalid certs
            rejectUnauthorized: false
        }
    });

    // Verify connection configuration
    try {
        await transporter.verify();
        console.log('SMTP server connection verified successfully');
    } catch (error) {
        console.error('SMTP server connection failed:', error);
        throw new Error('Failed to connect to SMTP server. Please check your configuration.');
    }

    return transporter;
};

// Export a promise that resolves to the transporter
export const emailTransporter = createTransporter();

export const EMAIL_CONFIG = {
    from: process.env.FROM_EMAIL || 'abdul@hypothesize.tech',
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