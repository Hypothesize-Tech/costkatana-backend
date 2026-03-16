import { z } from 'zod';

/**
 * User Profile Validation Schemas
 * Zod schemas for user-related API endpoints
 */

// Profile update schema
export const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  company: z.string().max(200).optional(),
  avatar: z.string().url('Invalid avatar URL').optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
});

// Preferences update schema (extracted from the nested preferences in updateProfileSchema)
export const updatePreferencesSchema = z
  .object({
    emailAlerts: z.boolean().optional(),
    alertThreshold: z.number().positive().optional(),
    optimizationSuggestions: z.boolean().optional(),
    enableSessionReplay: z.boolean().optional(),
    sessionReplayTimeout: z.number().optional(),
    lastDigestSent: z.string().datetime().optional(),
    maxConcurrentUserSessions: z.number().optional(),
    userSessionNotificationEnabled: z.boolean().optional(),
    language: z.string().optional(),
    timezone: z.string().optional(),
    dateFormat: z.string().optional(),
    currency: z.string().optional(),
    theme: z.string().optional(),
    emailDigest: z.string().optional(),
    autoOptimize: z.boolean().optional(),
    showCostInHeader: z.boolean().optional(),
    enableBetaFeatures: z.boolean().optional(),
    weeklyReports: z.boolean().optional(),
    emailEngagement: z
      .object({
        totalSent: z.number().optional(),
        totalOpened: z.number().optional(),
        totalClicked: z.number().optional(),
        consecutiveIgnored: z.number().optional(),
        lastOpened: z.string().datetime().optional(),
      })
      .optional(),
    integrations: z
      .object({
        alertTypeRouting: z.record(z.array(z.string())).optional(),
        defaultChannels: z.array(z.string()).optional(),
        fallbackToEmail: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough(); // Allow additional fields

// Email management schemas
export const addSecondaryEmailSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const setPrimaryEmailSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
});

// Account closure schemas
export const initiateAccountClosureSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  reason: z.string().optional(),
});

export const confirmClosureSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// Alert management schemas
export const alertSettingsSchema = z.object({
  emailAlerts: z.boolean().optional(),
  alertThreshold: z.number().positive().optional(),
  optimizationSuggestions: z.boolean().optional(),
  enableSessionReplay: z.boolean().optional(),
  sessionReplayTimeout: z.number().optional(),
});

// Snooze alert schema
export const snoozeAlertSchema = z.object({
  snoozeUntil: z.string().datetime('Invalid datetime format'),
});

// Test alert schema
export const testAlertSchema = z.object({
  // No specific fields required for testing
});

// Password change schema (for account management)
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Password confirmation is required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New password and confirmation don't match",
    path: ['confirmPassword'],
  });

// Email verification schema
export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
  email: z.string().email('Invalid email address').optional(),
});

// Common validation schemas
export const mongoIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId');

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  page: z.coerce.number().int().min(1).optional(),
});

export const dateRangeSchema = z
  .object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
      }
      return true;
    },
    { message: 'Start date must be before or equal to end date' },
  );

// Type exports for TypeScript inference
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesDto = z.infer<typeof updatePreferencesSchema>;
export type AddSecondaryEmailDto = z.infer<typeof addSecondaryEmailSchema>;
export type SetPrimaryEmailDto = z.infer<typeof setPrimaryEmailSchema>;
export type InitiateAccountClosureDto = z.infer<
  typeof initiateAccountClosureSchema
>;
export type PaginationQuery = z.infer<typeof paginationSchema>;
export type DateRangeQuery = z.infer<typeof dateRangeSchema>;
