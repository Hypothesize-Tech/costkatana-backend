import mongoose, { Schema, Document } from 'mongoose';

export interface IGoogleWorkflowTrigger {
    type: 'sheet_change' | 'form_submission' | 'calendar_event' | 'gmail_alert';
    service: 'sheets' | 'forms' | 'calendar' | 'gmail' | 'drive';
    config: {
        resourceId?: string;
        condition?: string;
        pollInterval?: number; // in minutes
    };
}

export interface IGoogleWorkflowAction {
    type: 'send_email' | 'create_calendar_event' | 'export_to_sheets' | 'create_doc' | 'create_slides' | 'upload_to_drive' | 'share_file' | 'create_form';
    service: 'gmail' | 'calendar' | 'sheets' | 'docs' | 'slides' | 'drive' | 'forms';
    config: Record<string, any>;
    order: number;
}

export interface IGoogleWorkflowCondition {
    field: string;
    operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains';
    value: any;
}

export interface IGoogleWorkflowExecution {
    timestamp: Date;
    status: 'success' | 'failure' | 'partial';
    duration: number; // in milliseconds
    error?: string;
    triggeredBy?: string;
}

export interface IGoogleWorkflow extends Document {
    workflowId: string;
    name: string;
    description?: string;
    userId: mongoose.Types.ObjectId;
    workspaceId?: mongoose.Types.ObjectId;
    trigger: IGoogleWorkflowTrigger;
    actions: IGoogleWorkflowAction[];
    conditions?: IGoogleWorkflowCondition[];
    schedule?: string; // cron expression
    isActive: boolean;
    lastExecution?: IGoogleWorkflowExecution;
    executionHistory: IGoogleWorkflowExecution[];
    createdAt: Date;
    updatedAt: Date;
}

const GoogleWorkflowSchema = new Schema<IGoogleWorkflow>(
    {
        workflowId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        name: {
            type: String,
            required: true
        },
        description: {
            type: String
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        workspaceId: {
            type: Schema.Types.ObjectId,
            ref: 'Workspace'
        },
        trigger: {
            type: {
                type: String,
                enum: ['sheet_change', 'form_submission', 'calendar_event', 'gmail_alert'],
                required: true
            },
            service: {
                type: String,
                enum: ['sheets', 'forms', 'calendar', 'gmail', 'drive'],
                required: true
            },
            config: {
                type: Schema.Types.Mixed,
                default: {}
            }
        },
        actions: [
            {
                type: {
                    type: String,
                    enum: ['send_email', 'create_calendar_event', 'export_to_sheets', 'create_doc', 'create_slides', 'upload_to_drive', 'share_file', 'create_form'],
                    required: true
                },
                service: {
                    type: String,
                    enum: ['gmail', 'calendar', 'sheets', 'docs', 'slides', 'drive', 'forms'],
                    required: true
                },
                config: {
                    type: Schema.Types.Mixed,
                    required: true
                },
                order: {
                    type: Number,
                    required: true
                }
            }
        ],
        conditions: [
            {
                field: {
                    type: String,
                    required: true
                },
                operator: {
                    type: String,
                    enum: ['equals', 'not_equals', 'greater_than', 'less_than', 'contains'],
                    required: true
                },
                value: {
                    type: Schema.Types.Mixed,
                    required: true
                }
            }
        ],
        schedule: {
            type: String // cron expression
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        },
        lastExecution: {
            timestamp: Date,
            status: {
                type: String,
                enum: ['success', 'failure', 'partial']
            },
            duration: Number,
            error: String,
            triggeredBy: String
        },
        executionHistory: [
            {
                timestamp: {
                    type: Date,
                    required: true
                },
                status: {
                    type: String,
                    enum: ['success', 'failure', 'partial'],
                    required: true
                },
                duration: {
                    type: Number,
                    required: true
                },
                error: String,
                triggeredBy: String
            }
        ]
    },
    {
        timestamps: true
    }
);

// Indexes for efficient queries
GoogleWorkflowSchema.index({ userId: 1, isActive: 1 });
GoogleWorkflowSchema.index({ 'trigger.type': 1 });
GoogleWorkflowSchema.index({ workspaceId: 1 });

export const GoogleWorkflow = mongoose.model<IGoogleWorkflow>('GoogleWorkflow', GoogleWorkflowSchema);

