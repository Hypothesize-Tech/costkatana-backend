import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  AgentKnowledgeBase,
  AgentKnowledgeBaseDocument,
} from '../../../schemas/agent-platform/agent-knowledge-base.schema';
import {
  AgentKbChunk,
  AgentKbChunkDocument,
} from '../../../schemas/agent-platform/agent-kb-chunk.schema';
import { SafeBedrockEmbeddings } from '../../agent/services/safe-bedrock-embeddings';
import { AgentDefinitionService } from './agent-definition.service';
import { KbIndexService } from './kb-index.service';
import {
  chunkText,
  extractTextFromBuffer,
  l2Normalize,
} from './kb-text-extractor';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const SHARED_BUCKET = process.env.AWS_S3_BUCKET || 'costkatana-media';
const KB_PREFIX_BASE = 'agent-platform/kb';
const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
const MAX_CHARS_PER_FILE = 1_000_000; // ~250k tokens — protect against giant uploads

interface UploadResult {
  kbId: string;
  status: AgentKnowledgeBaseDocument['status'];
  documentCount: number;
  chunkCount: number;
  uploadedKeys: string[];
  errors?: Array<{ filename: string; message: string }>;
}

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * End-to-end document ingestion for the agent-platform KB.
 *
 * Pipeline (one call → many documents):
 *   1. Upload original file to S3 at `agent-platform/kb/{orgId}/{kbId}/{docId}-{name}`
 *   2. Extract plaintext (PDF / DOCX / HTML / MD / TXT / CSV / JSON)
 *   3. Split into ~1000-char chunks (200-char overlap)
 *   4. Embed each chunk with Bedrock Titan v2 (`amazon.titan-embed-text-v2:0`)
 *   5. L2-normalize and persist as `AgentKbChunk` docs
 *   6. Invalidate the cached FAISS index so the next query rebuilds with new chunks
 *
 * No Bedrock Knowledge Base, no OpenSearch Serverless collection — vectors
 * live in `agent_kb_chunks` and retrieval is FAISS in-memory (with a JS
 * cosine fallback if `faiss-node` can't load).
 */
@Injectable()
export class KbIngestionService {
  private readonly logger = new Logger(KbIngestionService.name);
  private readonly s3 = new S3Client({ region: REGION });
  private readonly embeddings = new SafeBedrockEmbeddings({
    region: REGION,
    model: EMBEDDING_MODEL,
  });

  constructor(
    @InjectModel(AgentKnowledgeBase.name)
    private readonly kbModel: Model<AgentKnowledgeBaseDocument>,
    @InjectModel(AgentKbChunk.name)
    private readonly chunkModel: Model<AgentKbChunkDocument>,
    private readonly agentDefinitionService: AgentDefinitionService,
    private readonly kbIndexService: KbIndexService,
  ) {}

  async uploadDocuments(
    userId: string,
    files: UploadedFile[],
  ): Promise<UploadResult> {
    if (!files?.length) {
      throw new BadRequestException('No files provided');
    }
    const tenant = await this.agentDefinitionService.resolveTenant(userId);
    const orgId = tenant.organizationId.toHexString();

    const kbDoc = await this.ensureKnowledgeBase(orgId, userId);
    const uploadedKeys: string[] = [];
    const errors: Array<{ filename: string; message: string }> = [];
    let chunkCount = 0;

    for (const file of files) {
      try {
        const docId = new Types.ObjectId().toHexString();
        const safeName = file.originalname
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(0, 200);
        const s3Key = `${kbDoc.s3PrefixRoot}${docId}-${safeName}`;

        // 1. Upload original to S3
        await this.s3.send(
          new PutObjectCommand({
            Bucket: kbDoc.s3Bucket,
            Key: s3Key,
            Body: file.buffer,
            ContentType: file.mimetype || 'application/octet-stream',
            Metadata: {
              organizationId: orgId,
              knowledgeBaseId: String(kbDoc._id),
              uploadedBy: userId,
              uploadedAt: new Date().toISOString(),
            },
          }),
        );
        uploadedKeys.push(s3Key);

        // 2. Extract text
        const fullText = await extractTextFromBuffer(
          file.buffer,
          file.originalname,
          file.mimetype,
        );
        if (!fullText.trim()) {
          this.logger.warn(`No text extracted from ${file.originalname}`);
          continue;
        }
        const truncated = fullText.slice(0, MAX_CHARS_PER_FILE);

        // 3. Chunk
        const chunks = chunkText(truncated, { size: 1000, overlap: 200 });
        if (!chunks.length) continue;

        // 4. Embed (one chunk at a time — Titan v2 doesn't batch). For large
        // uploads we sequentialize to stay under the 1k req/min default
        // throttle; can swap to concurrency=4 if throughput becomes an issue.
        const chunkDocs: Array<{
          knowledgeBaseId: Types.ObjectId;
          organizationId: Types.ObjectId;
          docId: string;
          source: string;
          s3Key: string;
          ordinal: number;
          text: string;
          vector: number[];
          embeddingModel: string;
          dimension: number;
          charCount: number;
        }> = [];

        for (let i = 0; i < chunks.length; i++) {
          const text = chunks[i];
          let vector: number[];
          try {
            const raw = await this.embeddings.embedQuery(text);
            vector = l2Normalize(raw);
          } catch (err) {
            this.logger.warn(
              `Embedding failed for ${file.originalname}#${i}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            continue;
          }
          chunkDocs.push({
            knowledgeBaseId: kbDoc._id as Types.ObjectId,
            organizationId: tenant.organizationId,
            docId,
            source: file.originalname,
            s3Key,
            ordinal: i,
            text,
            vector,
            embeddingModel: EMBEDDING_MODEL,
            dimension: vector.length,
            charCount: text.length,
          });
        }

        // 5. Persist chunks (insertMany for one round-trip per file)
        if (chunkDocs.length) {
          await this.chunkModel.insertMany(chunkDocs);
          chunkCount += chunkDocs.length;
        }

        kbDoc.documentCount = (kbDoc.documentCount ?? 0) + 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Ingestion failed for ${file.originalname}: ${message}`);
        errors.push({ filename: file.originalname, message });
      }
    }

    kbDoc.status = chunkCount > 0 ? 'ready' : kbDoc.status;
    kbDoc.lastError = errors.length
      ? { message: errors.map((e) => `${e.filename}: ${e.message}`).join('; '), at: new Date() }
      : undefined;
    await kbDoc.save();

    // 6. Invalidate cached FAISS index — next retrieval will rebuild
    this.kbIndexService.invalidate(String(kbDoc._id));

    return {
      kbId: String(kbDoc._id),
      status: kbDoc.status,
      documentCount: kbDoc.documentCount,
      chunkCount,
      uploadedKeys,
      errors: errors.length ? errors : undefined,
    };
  }

  async getStatus(userId: string): Promise<{
    kb: AgentKnowledgeBaseDocument | null;
    chunkCount: number;
    documents: Array<{ docId: string; source: string; chunks: number }>;
  }> {
    const tenant = await this.agentDefinitionService.resolveTenant(userId);
    const kbDoc = await this.kbModel.findOne({
      organizationId: tenant.organizationId,
    });
    if (!kbDoc) return { kb: null, chunkCount: 0, documents: [] };

    const chunkCount = await this.chunkModel.countDocuments({
      knowledgeBaseId: kbDoc._id,
    });
    const docs = await this.chunkModel.aggregate<{
      _id: string;
      source: string;
      chunks: number;
    }>([
      { $match: { knowledgeBaseId: kbDoc._id } },
      {
        $group: {
          _id: '$docId',
          source: { $first: '$source' },
          chunks: { $sum: 1 },
        },
      },
      { $sort: { source: 1 } },
      { $limit: 200 },
    ]);
    return {
      kb: kbDoc,
      chunkCount,
      documents: docs.map((d) => ({ docId: d._id, source: d.source, chunks: d.chunks })),
    };
  }

  async deleteDocument(userId: string, docId: string): Promise<{ deleted: number }> {
    const tenant = await this.agentDefinitionService.resolveTenant(userId);
    const kbDoc = await this.kbModel.findOne({
      organizationId: tenant.organizationId,
    });
    if (!kbDoc) throw new NotFoundException('No knowledge base for this org');

    // Find chunks for this docId so we can also delete the S3 object.
    const sample = await this.chunkModel
      .findOne({ knowledgeBaseId: kbDoc._id, docId })
      .select('s3Key')
      .lean();
    if (!sample) {
      return { deleted: 0 };
    }

    const result = await this.chunkModel.deleteMany({
      knowledgeBaseId: kbDoc._id,
      docId,
    });
    if (sample.s3Key) {
      try {
        await this.s3.send(
          new DeleteObjectCommand({ Bucket: kbDoc.s3Bucket, Key: sample.s3Key }),
        );
      } catch (err) {
        this.logger.warn(
          `S3 delete failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    kbDoc.documentCount = Math.max(0, (kbDoc.documentCount ?? 0) - 1);
    await kbDoc.save();
    this.kbIndexService.invalidate(String(kbDoc._id));
    return { deleted: result.deletedCount ?? 0 };
  }

  // ──────────────────────── private ────────────────────────

  private async ensureKnowledgeBase(
    orgId: string,
    userId: string,
  ): Promise<AgentKnowledgeBaseDocument> {
    const orgObjectId = new Types.ObjectId(orgId);
    const existing = await this.kbModel.findOne({ organizationId: orgObjectId });
    if (existing) return existing;

    const tempId = new Types.ObjectId().toHexString();
    const prefix = `${KB_PREFIX_BASE}/${orgId}/${tempId}/`;

    return this.kbModel.create({
      organizationId: orgObjectId,
      s3Bucket: SHARED_BUCKET,
      s3PrefixRoot: prefix,
      embeddingModel: EMBEDDING_MODEL,
      status: 'ready',
      documentCount: 0,
      createdBy: new Types.ObjectId(userId),
    });
  }
}
