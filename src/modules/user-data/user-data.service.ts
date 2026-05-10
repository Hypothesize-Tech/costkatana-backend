/**
 * GDPR data-portability + erasure service.
 *
 * Two responsibilities:
 *
 *   - **Export** — gather everything we know about the user and return
 *     it as a structured JSON document. The export is synchronous and
 *     size-capped; if a user's footprint exceeds the cap we hand them a
 *     truncated payload with a `truncated: true` marker so they know to
 *     ask support for a full S3-backed export. The plan calls for an
 *     async S3 ZIP + emailed signed URL — that's the natural next step
 *     when a real user hits the cap.
 *
 *   - **Delete** — defers to the existing `AccountClosureService` so we
 *     don't duplicate the soft-delete grace-period state machine. The
 *     GDPR route is just a friendlier name + an audit-log entry.
 *
 * The PII redaction we layered into the audit chain (Phase 3.11) means
 * the export's audit-log slice is already redacted; we don't strip it
 * again here.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, AWS_CONFIG } from '../../config/aws';
import { User, UserDocument } from '../../schemas/user/user.schema';
import {
  ChatConversation,
  ChatConversationDocument,
} from '../../schemas/chat/conversation.schema';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../../schemas/chat/chat-message.schema';
import {
  UploadedFile,
  UploadedFileDocument,
} from '../../schemas/misc/uploaded-file.schema';
import {
  UserDataExportJob,
  UserDataExportJobDocument,
} from '../../schemas/misc/user-data-export-job.schema';
import { AccountClosureService } from '../account-closure/account-closure.service';

const MAX_MESSAGES = 5_000;
const MAX_CONVERSATIONS = 1_000;
const MAX_FILES = 1_000;

export interface UserDataExport {
  exportedAt: string;
  userId: string;
  user: Record<string, unknown>;
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  files: Array<Record<string, unknown>>;
  truncated: {
    conversations: boolean;
    messages: boolean;
    files: boolean;
  };
}

@Injectable()
export class UserDataService {
  private readonly logger = new Logger(UserDataService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(ChatConversation.name)
    private readonly conversationModel: Model<ChatConversationDocument>,
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(UploadedFile.name)
    private readonly uploadedFileModel: Model<UploadedFileDocument>,
    @InjectModel(UserDataExportJob.name)
    private readonly exportJobModel: Model<UserDataExportJobDocument>,
    private readonly accountClosureService: AccountClosureService,
  ) {}

  async exportUserData(userId: string): Promise<UserDataExport> {
    const user = await this.userModel.findById(userId).lean().exec();
    if (!user) throw new NotFoundException('User not found');

    const userObjId = new Types.ObjectId(userId);

    // Fetch slices with explicit caps — never load an unbounded set of
    // records into memory just because the user has been a heavy user.
    const [conversations, messages, files] = await Promise.all([
      this.conversationModel
        .find({ userId: userObjId })
        .sort({ createdAt: -1 })
        .limit(MAX_CONVERSATIONS + 1)
        .lean()
        .exec(),
      this.chatMessageModel
        .find({ userId: userObjId })
        .sort({ createdAt: -1 })
        .limit(MAX_MESSAGES + 1)
        .lean()
        .exec(),
      this.uploadedFileModel
        .find({ userId: userObjId })
        .sort({ uploadedAt: -1 })
        .limit(MAX_FILES + 1)
        .lean()
        .exec(),
    ]);

    // Strip server-side secret material from the user record. `passwordHash`
    // / `mfaSecret` etc. shouldn't go in an export. Whitelist what we DO
    // want rather than blacklist — safer when new fields land.
    const safeUser = {
      _id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      preferences: (user as { preferences?: unknown }).preferences,
    };

    const truncated = {
      conversations: conversations.length > MAX_CONVERSATIONS,
      messages: messages.length > MAX_MESSAGES,
      files: files.length > MAX_FILES,
    };

    this.logger.log('User data export generated', {
      userId,
      conversationCount: Math.min(conversations.length, MAX_CONVERSATIONS),
      messageCount: Math.min(messages.length, MAX_MESSAGES),
      fileCount: Math.min(files.length, MAX_FILES),
      truncated,
    });

    return {
      exportedAt: new Date().toISOString(),
      userId,
      user: safeUser,
      conversations: conversations.slice(0, MAX_CONVERSATIONS).map((c) => ({
        _id: String(c._id),
        title: (c as { title?: string }).title,
        createdAt: (c as { createdAt?: Date }).createdAt,
        updatedAt: (c as { updatedAt?: Date }).updatedAt,
        messageCount: (c as { messageCount?: number }).messageCount,
        totalCost: (c as { totalCost?: number }).totalCost,
      })),
      messages: messages.slice(0, MAX_MESSAGES).map((m) => ({
        _id: String(m._id),
        conversationId: String((m as { conversationId?: unknown }).conversationId),
        role: (m as { role?: string }).role,
        content: (m as { content?: string }).content,
        modelId: (m as { modelId?: string }).modelId,
        createdAt: (m as { createdAt?: Date }).createdAt,
      })),
      files: files.slice(0, MAX_FILES).map((f) => ({
        _id: String(f._id),
        fileName: (f as { fileName?: string }).fileName,
        fileSize: (f as { fileSize?: number }).fileSize,
        mimeType: (f as { mimeType?: string }).mimeType,
        uploadedAt: (f as { uploadedAt?: Date }).uploadedAt,
      })),
      truncated,
    };
  }

  /**
   * S3-backed export. Generates the same JSON snapshot, uploads it to
   * S3 under `user-exports/{userId}/{timestamp}.json`, and returns a
   * 24h presigned download URL. Caller is expected to email the URL
   * (or render it on a download page).
   *
   * We pick JSON over a zipped folder for now because: (a) the export
   * is a single document so zipping adds I/O without compression
   * value, and (b) avoids pulling in a zip dependency. If/when files
   * become part of the export (binary attachments), upgrade to ZIP.
   */
  async exportUserDataToS3(
    userId: string,
  ): Promise<{ s3Key: string; signedUrl: string; expiresIn: number }> {
    const data = await this.exportUserData(userId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key = `user-exports/${userId}/${timestamp}.json`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: AWS_CONFIG.s3.bucketName,
        Key: s3Key,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json',
        // Server-side encryption is on at the bucket level; this
        // metadata is just for human auditing.
        Metadata: {
          'export-user-id': userId,
          'export-generated-at': data.exportedAt,
        },
      }),
    );

    const expiresIn = 24 * 60 * 60; // 24h — matches the plan's contract
    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: AWS_CONFIG.s3.bucketName,
        Key: s3Key,
      }),
      { expiresIn },
    );

    this.logger.log('User data export uploaded to S3', {
      userId,
      s3Key,
      expiresIn,
    });

    return { s3Key, signedUrl, expiresIn };
  }

  /**
   * Kick off an async export. Creates a `pending` job row, schedules
   * the actual generation+upload via setImmediate so the HTTP response
   * isn't blocked, and returns the job id for the caller to poll.
   *
   * Why setImmediate over a queue: the export is one-shot, idempotent,
   * and rarely runs (a user invokes it manually). Adding a BullMQ job
   * for it would just add ops surface. If/when GDPR exports become
   * frequent enough to warrant queueing, swap this for the existing
   * webhook BullMQ.
   */
  async startExportJob(userId: string): Promise<{ jobId: string }> {
    const job = await this.exportJobModel.create({
      userId: new Types.ObjectId(userId),
      status: 'pending',
    });
    const jobId = String(job._id);
    setImmediate(() => {
      void this.runExportJob(jobId, userId);
    });
    this.logger.log('User data export job queued', { userId, jobId });
    return { jobId };
  }

  async getExportJob(
    userId: string,
    jobId: string,
  ): Promise<{
    status: 'pending' | 'ready' | 'failed';
    downloadUrl?: string;
    expiresAt?: Date;
    error?: string;
  } | null> {
    if (!Types.ObjectId.isValid(jobId)) return null;
    const job = await this.exportJobModel
      .findOne({
        _id: new Types.ObjectId(jobId),
        userId: new Types.ObjectId(userId),
      })
      .lean()
      .exec();
    if (!job) return null;
    return {
      status: job.status,
      downloadUrl: job.signedUrl,
      expiresAt: job.expiresAt,
      error: job.error,
    };
  }

  /**
   * Background worker. Generates the export, uploads to S3, marks the
   * job ready (or failed). Always best-effort — any error is recorded
   * on the job row so the caller can see it on the next poll.
   */
  private async runExportJob(jobId: string, userId: string): Promise<void> {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    try {
      const { signedUrl, s3Key, expiresIn } = await this.exportUserDataToS3(
        userId,
      );
      await this.exportJobModel.updateOne(
        { _id: new Types.ObjectId(jobId) },
        {
          $set: {
            status: 'ready',
            s3Key,
            signedUrl,
            expiresAt: new Date(Date.now() + expiresIn * 1000),
            completedAt: new Date(),
            purgeAt: new Date(Date.now() + sevenDaysMs),
          },
        },
      );
      this.logger.log('User data export job completed', { userId, jobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.exportJobModel.updateOne(
        { _id: new Types.ObjectId(jobId) },
        {
          $set: {
            status: 'failed',
            error: message,
            completedAt: new Date(),
            purgeAt: new Date(Date.now() + sevenDaysMs),
          },
        },
      );
      this.logger.error('User data export job failed', {
        userId,
        jobId,
        error: message,
      });
    }
  }

  /**
   * GDPR erasure request. Defers to AccountClosureService — which
   * requires re-auth via password to confirm the destructive action,
   * even though the caller already passed JWT auth. Matches the
   * defense-in-depth posture of the existing close-account flow.
   */
  async requestDeletion(
    userId: string,
    password: string,
    reason?: string,
  ): Promise<{ message: string; gracePeriodDays: number }> {
    return this.accountClosureService
      .initiateAccountClosure(userId, password, reason)
      .then((res) => ({
        message: res.message,
        // Default grace per AccountClosureService is 30 days; if the
        // service ever reads this from config we should plumb it
        // through, but for now matching the documented contract is
        // correct.
        gracePeriodDays: 30,
      }));
  }
}
