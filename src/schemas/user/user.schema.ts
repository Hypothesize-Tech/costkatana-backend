import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import * as bcrypt from 'bcryptjs';

export interface IOauthProvider {
  provider: 'google' | 'github';
  providerId: string;
  email: string;
  name?: string;
  avatar?: string;
  linkedAt: Date;
}

export interface IOtherEmail {
  email: string;
  verified: boolean;
  verificationToken?: string;
  addedAt: Date;
}

export interface IDashboardApiKey {
  name: string;
  keyId: string;
  encryptedKey: string;
  maskedKey: string;
  permissions: string[];
  lastUsed?: Date;
  createdAt: Date;
  expiresAt?: Date;
  isActive?: boolean;
}

export interface IApiKey {
  id: string;
  name: string;
  key: string;
  created: Date;
  lastUsed?: Date;
  isActive: boolean;
}

export interface IUserPreferences {
  emailAlerts: boolean;
  alertThreshold: number;
  optimizationSuggestions: boolean;
  enableSessionReplay?: boolean;
  sessionReplayTimeout?: number;
  lastDigestSent?: Date;
  maxConcurrentUserSessions?: number;
  userSessionNotificationEnabled?: boolean;
  emailEngagement?: {
    totalSent: number;
    totalOpened: number;
    totalClicked: number;
    lastOpened?: Date;
    consecutiveIgnored: number;
  };
  integrations?: {
    defaultChannels?: string[];
    alertTypeRouting?: Map<string, string[]>;
    fallbackToEmail?: boolean;
  };
}

export interface IWorkspaceMembership {
  workspaceId: MongooseSchema.Types.ObjectId;
  role: 'owner' | 'admin' | 'developer' | 'viewer';
  joinedAt: Date;
}

export interface IUsage {
  currentMonth: {
    apiCalls: number;
    totalCost: number;
    totalTokens: number;
    optimizationsSaved: number;
  };
}

export interface IMfa {
  enabled: boolean;
  methods: Array<'email' | 'totp'>;
  email: {
    enabled: boolean;
    code?: string;
    codeExpires?: Date;
    attempts: number;
    lastAttempt?: Date;
  };
  totp: {
    enabled: boolean;
    secret?: string;
    backupCodes: string[];
    lastUsed?: Date;
  };
  trustedDevices: Array<{
    deviceId: string;
    deviceName: string;
    userAgent: string;
    ipAddress: string;
    createdAt: Date;
    lastUsed: Date;
    expiresAt: Date;
  }>;
}

export interface IOnboarding {
  completed: boolean;
  completedAt?: Date;
  skipped?: boolean;
  skippedAt?: Date;
  projectCreated: boolean;
  firstLlmCall: boolean;
  stepsCompleted: string[];
}

export interface IAccountClosure {
  status: 'active' | 'pending_deletion' | 'deleted';
  requestedAt?: Date;
  scheduledDeletionAt?: Date;
  deletionToken?: string;
  confirmationStatus: {
    passwordConfirmed: boolean;
    emailConfirmed: boolean;
    cooldownCompleted: boolean;
  };
  cooldownStartedAt?: Date;
  reason?: string;
  reactivationCount: number;
}

export interface IUserMethods {
  comparePassword(candidatePassword: string): Promise<boolean>;
  resetMonthlyUsage(): Promise<void>;
}

export type UserDocument = HydratedDocument<User> & IUserMethods;

@Schema({ timestamps: true })
export class User implements IUserMethods {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: false, minlength: 8 })
  password?: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  company?: string;

  @Prop()
  avatar?: string;

  @Prop({ enum: ['user', 'admin'], default: 'user' })
  role: 'user' | 'admin';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Workspace' })
  workspaceId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: [
      {
        provider: { type: String, enum: ['google', 'github'], required: true },
        providerId: { type: String, required: true },
        email: { type: String, required: true, lowercase: true, trim: true },
        linkedAt: { type: Date, default: Date.now },
      },
    ],
    _id: false,
  })
  oauthProviders: IOauthProvider[];

  @Prop({
    type: [
      {
        workspaceId: {
          type: MongooseSchema.Types.ObjectId,
          ref: 'Workspace',
          required: true,
        },
        role: {
          type: String,
          enum: ['owner', 'admin', 'developer', 'viewer'],
          required: true,
        },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    _id: false,
  })
  workspaceMemberships: IWorkspaceMembership[];

  @Prop({
    type: [
      {
        email: { type: String, required: true, lowercase: true, trim: true },
        verified: { type: Boolean, default: false },
        verificationToken: String,
        addedAt: { type: Date, default: Date.now },
      },
    ],
    _id: false,
  })
  otherEmails: IOtherEmail[];

  @Prop({
    type: [
      {
        name: { type: String, required: true, trim: true },
        keyId: String,
        encryptedKey: { type: String, required: true },
        maskedKey: { type: String, required: true },
        permissions: [
          { type: String, enum: ['read', 'write', 'admin'], default: 'read' },
        ],
        lastUsed: Date,
        createdAt: { type: Date, default: Date.now },
        expiresAt: Date,
        isActive: { type: Boolean, default: true },
      },
    ],
    _id: false,
  })
  dashboardApiKeys: IDashboardApiKey[];

  @Prop({
    type: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true, trim: true },
        key: { type: String, required: true },
        created: { type: Date, default: Date.now },
        lastUsed: Date,
        isActive: { type: Boolean, default: true },
      },
    ],
    _id: false,
  })
  apiKeys: IApiKey[];

  @Prop({
    type: {
      emailAlerts: { type: Boolean, default: true },
      enableSessionReplay: { type: Boolean, default: false },
      sessionReplayTimeout: { type: Number, default: 30 },
      alertThreshold: { type: Number, default: 100 },
      optimizationSuggestions: { type: Boolean, default: true },
      maxConcurrentUserSessions: { type: Number, default: 10 },
      userSessionNotificationEnabled: { type: Boolean, default: true },
      lastDigestSent: Date,
      emailEngagement: {
        totalSent: { type: Number, default: 0 },
        totalOpened: { type: Number, default: 0 },
        totalClicked: { type: Number, default: 0 },
        lastOpened: Date,
        consecutiveIgnored: { type: Number, default: 0 },
      },
      integrations: {
        defaultChannels: [{ type: String }],
        alertTypeRouting: { type: Map, of: [String], default: new Map() },
        fallbackToEmail: { type: Boolean, default: true },
      },
    },
    _id: false,
  })
  preferences: IUserPreferences;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Subscription',
    index: true,
  })
  subscriptionId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: {
      currentMonth: {
        apiCalls: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 },
        optimizationsSaved: { type: Number, default: 0 },
      },
    },
    _id: false,
  })
  usage: IUsage;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: false })
  emailVerified: boolean;

  @Prop()
  verificationToken?: string;

  @Prop()
  verificationTokenExpires?: Date;

  @Prop()
  resetPasswordToken?: string;

  @Prop()
  resetPasswordExpires?: Date;

  @Prop()
  lastLogin?: Date;

  @Prop({ enum: ['email', 'google', 'github'] })
  lastLoginMethod?: 'email' | 'google' | 'github';

  @Prop({ type: MongooseSchema.Types.Mixed })
  optimizationConfig?: Record<string, any>;

  @Prop({ uppercase: true, trim: true, maxlength: 2 })
  country?: string;

  @Prop({
    type: {
      enabled: { type: Boolean, default: false },
      methods: [{ type: String, enum: ['email', 'totp'] }],
      email: {
        enabled: { type: Boolean, default: false },
        code: String,
        codeExpires: Date,
        attempts: { type: Number, default: 0 },
        lastAttempt: Date,
      },
      totp: {
        enabled: { type: Boolean, default: false },
        secret: String,
        backupCodes: [{ type: String }],
        lastUsed: Date,
      },
      trustedDevices: [
        {
          deviceId: { type: String, required: true },
          deviceName: { type: String, required: true },
          userAgent: { type: String, required: true },
          ipAddress: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
          lastUsed: { type: Date, default: Date.now },
          expiresAt: { type: Date, required: true },
        },
      ],
    },
    _id: false,
  })
  mfa: IMfa;

  @Prop({
    type: {
      completed: { type: Boolean, default: false },
      completedAt: Date,
      skipped: { type: Boolean, default: false },
      skippedAt: Date,
      projectCreated: { type: Boolean, default: false },
      firstLlmCall: { type: Boolean, default: false },
      stepsCompleted: [{ type: String }],
    },
    _id: false,
  })
  onboarding: IOnboarding;

  @Prop({
    type: {
      status: {
        type: String,
        enum: ['active', 'pending_deletion', 'deleted'],
        default: 'active',
      },
      requestedAt: Date,
      scheduledDeletionAt: Date,
      deletionToken: String,
      confirmationStatus: {
        passwordConfirmed: { type: Boolean, default: false },
        emailConfirmed: { type: Boolean, default: false },
        cooldownCompleted: { type: Boolean, default: false },
      },
      cooldownStartedAt: Date,
      reason: String,
      reactivationCount: { type: Number, default: 0 },
    },
    _id: false,
  })
  accountClosure: IAccountClosure;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  async comparePassword(candidatePassword: string): Promise<boolean> {
    if (!this.password) {
      throw new Error('No password set for this user. Please use OAuth login.');
    }
    return bcrypt.compare(candidatePassword, this.password);
  }

  async resetMonthlyUsage(): Promise<void> {
    this.usage.currentMonth = {
      apiCalls: 0,
      totalCost: 0,
      totalTokens: 0,
      optimizationsSaved: 0,
    };
    // Note: In the actual schema methods below, we use (this as any).save()
  }
}

export const UserSchema = SchemaFactory.createForClass(User);

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    next(error);
  }
});

// Add instance methods
UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.password) {
    throw new Error('No password set for this user. Please use OAuth login.');
  }
  return bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.resetMonthlyUsage = async function () {
  this.usage.currentMonth = {
    apiCalls: 0,
    totalCost: 0,
    totalTokens: 0,
    optimizationsSaved: 0,
  };
  await this.save();
};

// Add static methods
UserSchema.statics.resetAllMonthlyUsage = async function () {
  await this.updateMany(
    {},
    {
      $set: {
        'usage.currentMonth': {
          apiCalls: 0,
          totalCost: 0,
          totalTokens: 0,
          optimizationsSaved: 0,
        },
      },
    },
  );
};

// Virtual populate for subscription
UserSchema.virtual('subscription', {
  ref: 'Subscription',
  localField: 'subscriptionId',
  foreignField: '_id',
  justOne: true,
});

// Indexes
UserSchema.index({ createdAt: -1 });
UserSchema.index({ 'dashboardApiKeys.keyId': 1, _id: 1 });
UserSchema.index({ 'otherEmails.email': 1 });
UserSchema.index({ workspaceId: 1 });
UserSchema.index({ 'workspaceMemberships.workspaceId': 1 });
UserSchema.index({ 'oauthProviders.providerId': 1 });
UserSchema.index({
  'oauthProviders.provider': 1,
  'oauthProviders.providerId': 1,
});
