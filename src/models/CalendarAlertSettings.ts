import mongoose, { Schema, Document } from 'mongoose';

export interface ICalendarThreshold {
    percentage: number; // e.g., 50, 75, 90, 100
    color: 'green' | 'yellow' | 'orange' | 'red';
    notifyBefore: number; // hours before threshold is hit
}

export interface ICalendarAlertSettings extends Document {
    userId: mongoose.Types.ObjectId;
    workspaceId?: mongoose.Types.ObjectId;
    enabled: boolean;
    calendarId: string; // Google Calendar ID
    thresholds: ICalendarThreshold[];
    recipients: string[]; // email addresses
    services: {
        budget: boolean;
        usage: boolean;
        anomaly: boolean;
    };
    reminderDefaults: {
        timing: number[]; // minutes before event (e.g., [15, 60, 1440])
        method: 'email' | 'popup' | 'both';
    };
    createdAt: Date;
    updatedAt: Date;
}

const CalendarAlertSettingsSchema = new Schema<ICalendarAlertSettings>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true
        },
        workspaceId: {
            type: Schema.Types.ObjectId,
            ref: 'Workspace'
        },
        enabled: {
            type: Boolean,
            default: true
        },
        calendarId: {
            type: String,
            required: true
        },
        thresholds: [
            {
                percentage: {
                    type: Number,
                    required: true,
                    min: 0,
                    max: 100
                },
                color: {
                    type: String,
                    enum: ['green', 'yellow', 'orange', 'red'],
                    required: true
                },
                notifyBefore: {
                    type: Number,
                    required: true,
                    min: 0
                }
            }
        ],
        recipients: [
            {
                type: String,
                validate: {
                    validator: function (email: string) {
                        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
                    },
                    message: 'Invalid email address'
                }
            }
        ],
        services: {
            budget: {
                type: Boolean,
                default: true
            },
            usage: {
                type: Boolean,
                default: true
            },
            anomaly: {
                type: Boolean,
                default: true
            }
        },
        reminderDefaults: {
            timing: {
                type: [Number],
                default: [15, 60, 1440] // 15 min, 1 hour, 1 day
            },
            method: {
                type: String,
                enum: ['email', 'popup', 'both'],
                default: 'both'
            }
        }
    },
    {
        timestamps: true
    }
);

// Indexes
CalendarAlertSettingsSchema.index({ workspaceId: 1 });
CalendarAlertSettingsSchema.index({ enabled: 1 });

export const CalendarAlertSettings = mongoose.model<ICalendarAlertSettings>(
    'CalendarAlertSettings',
    CalendarAlertSettingsSchema
);

