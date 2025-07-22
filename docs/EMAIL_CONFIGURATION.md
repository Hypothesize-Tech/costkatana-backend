# Email Configuration

The Cost Katana backend uses SMTP for sending emails. This guide explains how to configure email functionality.

## Required Environment Variables

Add these environment variables to your `.env` file:

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_PASS=your-app-password
FROM_EMAIL=your-email@example.com

# Optional
EMAIL_ALERT_THRESHOLD=100
```

## Gmail Setup

If using Gmail, you'll need to:

1. Enable 2-factor authentication on your Google account
2. Generate an app-specific password:
   - Go to https://myaccount.google.com/security
   - Click on "2-Step Verification"
   - Scroll down and click on "App passwords"
   - Generate a new app password for "Mail"
   - Use this password as `SMTP_PASS`

## Other Email Providers

For other providers, update the SMTP settings accordingly:

### SendGrid
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_PASS=your-sendgrid-api-key
FROM_EMAIL=your-email@example.com
```

### Mailgun
```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_PASS=your-mailgun-password
FROM_EMAIL=your-email@example.com
```

### AWS SES
```env
SMTP_HOST=email-smtp.region.amazonaws.com
SMTP_PORT=587
SMTP_PASS=your-ses-smtp-password
FROM_EMAIL=verified-email@example.com
```

## Email Types

The system sends the following types of emails:

1. **Verification Email** - Sent when a new user registers
2. **Password Reset Email** - Sent when user requests password reset
3. **Cost Alert** - Sent when usage exceeds threshold
4. **Optimization Alert** - Sent when new optimization opportunities are found
5. **Weekly Report** - Sent weekly with usage summary
6. **Alert Notifications** - Sent for various system alerts

## Troubleshooting

If emails are not being sent:

1. Check the console logs for SMTP connection errors
2. Verify your SMTP credentials are correct
3. Ensure your firewall allows outbound connections on port 587
4. For Gmail, make sure "Less secure app access" is not required (use app passwords instead)

## Testing

To test email functionality:

1. Register a new user to trigger verification email
2. Use the forgot password feature
3. Set a low cost threshold to trigger alerts

The system will log successful email sends and any errors to the console. 