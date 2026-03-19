import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as math from 'mathjs';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import {
  VectorizationJob,
  VectorizationJobDocument,
} from '../../../schemas/vectorization/vectorization-job.schema';
import {
  VectorizationDocument,
  VectorizationDocumentDocument,
} from '../../../schemas/vectorization/vectorization-document.schema';

@Injectable()
export class BackgroundVectorizationService {
  private readonly logger = new Logger(BackgroundVectorizationService.name);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    @InjectModel(VectorizationJob.name)
    private vectorizationJobModel: Model<VectorizationJobDocument>,
    @InjectModel(VectorizationDocument.name)
    private vectorizationDocumentModel: Model<VectorizationDocumentDocument>,
    private readonly httpService: HttpService,
  ) {}

  /**
   * Start a vectorization job
   */
  async startVectorizationJob(
    samplingRate: number = 0.1,
    vectorizationMethod: string = 'pca',
    targetDimensions: number = 128,
  ): Promise<string> {
    try {
      const jobId = `vec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const job = new this.vectorizationJobModel({
        jobId,
        status: 'pending',
        progress: 0,
        totalItems: 0,
        processedItems: 0,
        startTime: new Date(),
        config: {
          samplingRate,
          vectorizationMethod,
          targetDimensions,
        },
      });

      await job.save();

      // Start the job asynchronously
      this.processVectorizationJob(jobId);

      this.logger.log(`Started vectorization job: ${jobId}`);

      return jobId;
    } catch (error) {
      this.logger.error('Error starting vectorization job:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'BackgroundVectorizationService',
        operation: 'startVectorizationJob',
      });
      throw error;
    }
  }

  /**
   * Get vectorization job status
   */
  async getVectorizationJobStatus(jobId: string): Promise<any> {
    try {
      const job = await this.vectorizationJobModel.findOne({ jobId }).exec();

      if (!job) {
        throw new Error(`Vectorization job ${jobId} not found`);
      }

      return {
        id: job.jobId,
        status: job.status,
        progress: job.progress,
        totalItems: job.totalItems,
        processedItems: job.processedItems,
        startTime: job.startTime,
        endTime: job.endTime,
        duration: job.endTime
          ? job.endTime.getTime() - job.startTime.getTime()
          : Date.now() - job.startTime.getTime(),
        error: job.error,
        config: job.config,
      };
    } catch (error) {
      this.logger.error('Error getting vectorization job status:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'BackgroundVectorizationService',
        operation: 'getVectorizationJobStatus',
      });
      throw error;
    }
  }

  /**
   * Get all vectorization jobs
   */
  async getVectorizationJobs(): Promise<any[]> {
    try {
      const jobs = await this.vectorizationJobModel
        .find({})
        .sort({ createdAt: -1 })
        .exec();

      return jobs.map((job) => ({
        id: job.jobId,
        status: job.status,
        progress: job.progress,
        totalItems: job.totalItems,
        processedItems: job.processedItems,
        startTime: job.startTime,
        endTime: job.endTime,
        duration: job.endTime
          ? job.endTime.getTime() - job.startTime.getTime()
          : Date.now() - job.startTime.getTime(),
        error: job.error,
        config: job.config,
      }));
    } catch (error) {
      this.logger.error('Error getting vectorization jobs:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'BackgroundVectorizationService',
        operation: 'getVectorizationJobs',
      });
      throw error;
    }
  }

  /**
   * Cancel a vectorization job
   */
  async cancelVectorizationJob(jobId: string): Promise<void> {
    try {
      const job = await this.vectorizationJobModel.findOne({ jobId }).exec();

      if (!job) {
        throw new Error(`Vectorization job ${jobId} not found`);
      }

      if (job.status === 'running') {
        job.status = 'failed';
        job.endTime = new Date();
        job.error = 'Job cancelled by user';
        await job.save();
      }

      this.logger.log(`Cancelled vectorization job: ${jobId}`);
    } catch (error) {
      this.logger.error('Error cancelling vectorization job:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'BackgroundVectorizationService',
        operation: 'cancelVectorizationJob',
      });
      throw error;
    }
  }

  /**
   * Process a vectorization job with real data processing
   */
  private async processVectorizationJob(jobId: string): Promise<void> {
    try {
      const job = await this.vectorizationJobModel.findOne({ jobId }).exec();
      if (!job) return;

      job.status = 'running';
      await job.save();

      // Get usage data for vectorization
      const usageData = await this.usageModel
        .find({})
        .select(
          'userId projectId model tokens promptTokens completionTokens cost latency requestTimestamp responseTimestamp',
        )
        .limit(10000) // Process up to 10k records for performance
        .lean();

      if (usageData.length === 0) {
        job.status = 'failed';
        job.endTime = new Date();
        job.error = 'No usage data available for vectorization';
        await job.save();
        return;
      }

      job.totalItems = usageData.length;
      job.processedItems = 0;
      job.progress = 0;
      await job.save();

      // Process data in chunks for better performance and progress tracking
      const chunkSize = 500;
      const chunks = Math.ceil(usageData.length / chunkSize);

      const featureVectors: number[][] = [];
      const metadata: any[] = [];

      for (let i = 0; i < chunks; i++) {
        // Check if job was cancelled
        if ((job as { status: string }).status === 'failed') {
          break;
        }

        const startIdx = i * chunkSize;
        const endIdx = Math.min((i + 1) * chunkSize, usageData.length);
        const chunk = usageData.slice(startIdx, endIdx);

        // Extract features from usage data
        for (const usage of chunk) {
          try {
            const features = this.extractFeatures(usage);
            featureVectors.push(features);
            metadata.push({
              userId: usage.userId,
              projectId: usage.projectId,
              model: usage.model,
              usageId: usage._id,
            });
          } catch (error) {
            this.logger.warn(
              `Failed to extract features for usage ${usage._id}`,
              { error },
            );
          }
        }

        job.processedItems = Math.min(endIdx, usageData.length);
        job.progress = Math.round((job.processedItems / usageData.length) * 50); // First 50% for feature extraction
      }

      if ((job as { status: string }).status === 'failed') {
        return;
      }

      // Apply vectorization method
      let vectorizedData: number[][] = [];

      try {
        if (job.config.vectorizationMethod === 'pca') {
          vectorizedData = this.applyPCA(
            featureVectors,
            job.config.targetDimensions,
          );
        } else if (job.config.vectorizationMethod === 'feature_selection') {
          vectorizedData = this.applyFeatureSelection(
            featureVectors,
            job.config.targetDimensions,
          );
        } else {
          // Default: simple dimensionality reduction
          vectorizedData = this.applySimpleReduction(
            featureVectors,
            job.config.targetDimensions,
          );
        }

        job.progress = 75; // 75% complete - vectorization done
      } catch (error) {
        this.logger.error('Vectorization processing failed', {
          error,
          method: job.config.vectorizationMethod,
        });
        job.status = 'failed';
        job.endTime = new Date();
        job.error = `Vectorization failed: ${error instanceof Error ? error.message : String(error)}`;
        await job.save();
        return;
      }

      // Store vectorized data in MongoDB and external vector databases if configured
      try {
        await this.storeVectorizedData(vectorizedData, metadata, jobId);
        job.progress = 100;
      } catch (error) {
        this.logger.error('Failed to store vectorized data', { error });
        // Don't fail the job if storage fails, but log the error
      }

      if ((job as { status: string }).status !== 'failed') {
        job.status = 'completed';
        job.endTime = new Date();
        job.progress = 100;
        await job.save();
      }

      this.logger.log(
        `Completed vectorization job: ${jobId} with status: ${job.status}. Processed ${featureVectors.length} items, created ${vectorizedData.length} vectors.`,
      );
    } catch (error) {
      const job = await this.vectorizationJobModel.findOne({ jobId }).exec();
      if (job) {
        job.status = 'failed';
        job.endTime = new Date();
        job.error = error instanceof Error ? error.message : String(error);
        await job.save();
      }

      this.logger.error(`Error processing vectorization job ${jobId}:`, error);
    }
  }

  /**
   * Extract feature vector from usage data
   */
  private extractFeatures(usage: any): number[] {
    const features: number[] = [];

    // Numerical features
    features.push(usage.tokens || 0);
    features.push(usage.promptTokens || 0);
    features.push(usage.completionTokens || 0);
    features.push(usage.cost || 0);
    features.push(usage.latency || 0);

    // Time-based features
    const requestTime = usage.requestTimestamp
      ? new Date(usage.requestTimestamp).getTime()
      : Date.now();
    const responseTime = usage.responseTimestamp
      ? new Date(usage.responseTimestamp).getTime()
      : Date.now();
    const actualLatency = responseTime - requestTime;

    features.push(actualLatency);
    features.push(new Date(requestTime).getHours()); // Hour of day
    features.push(new Date(requestTime).getDay()); // Day of week

    // Model encoding (simple ordinal encoding)
    const modelEncoding = this.encodeModel(usage.model);
    features.push(modelEncoding);

    // Token efficiency metrics
    const totalTokens =
      (usage.promptTokens || 0) + (usage.completionTokens || 0);
    const tokenEfficiency =
      totalTokens > 0 ? (usage.tokens || 0) / totalTokens : 0;
    features.push(tokenEfficiency);

    // Cost efficiency
    const costEfficiency =
      usage.tokens > 0 ? (usage.cost || 0) / usage.tokens : 0;
    features.push(costEfficiency);

    return features;
  }

  /**
   * Simple model encoding (ordinal)
   */
  private encodeModel(model: string): number {
    const modelMap: { [key: string]: number } = {
      'gpt-4': 1,
      'gpt-4-turbo': 2,
      'gpt-3.5-turbo': 3,
      'claude-3': 4,
      'claude-3-sonnet': 5,
      'claude-3-haiku': 6,
      'gemini-pro': 7,
      'gemini-pro-vision': 8,
    };

    // Extract base model name for encoding
    const baseModel = model?.toLowerCase().split('-')[0] || 'unknown';
    return modelMap[baseModel] || 0;
  }

  /**
   * Apply Principal Component Analysis (simplified version)
   */
  private applyPCA(vectors: number[][], targetDimensions: number): number[][] {
    if (vectors.length === 0 || vectors[0].length === 0) {
      return vectors;
    }

    const numFeatures = vectors[0].length;
    if (targetDimensions >= numFeatures) {
      return vectors;
    }

    // Simple PCA implementation using covariance matrix
    const mean = this.calculateMean(vectors);
    const centered = this.centerData(vectors, mean);
    const covariance = this.calculateCovariance(centered);

    // Get eigenvectors (simplified - using power iteration for largest eigenvalues)
    const eigenvectors = this.computeEigenvectors(covariance, targetDimensions);

    // Project data onto principal components
    return centered.map((vector) => {
      const projected: number[] = [];
      for (let i = 0; i < targetDimensions; i++) {
        let dotProduct = 0;
        for (let j = 0; j < numFeatures; j++) {
          dotProduct += vector[j] * eigenvectors[i][j];
        }
        projected.push(dotProduct);
      }
      return projected;
    });
  }

  /**
   * Apply feature selection (select most variable features)
   */
  private applyFeatureSelection(
    vectors: number[][],
    targetDimensions: number,
  ): number[][] {
    if (vectors.length === 0 || vectors[0].length === 0) {
      return vectors;
    }

    const numFeatures = vectors[0].length;
    if (targetDimensions >= numFeatures) {
      return vectors;
    }

    // Calculate variance for each feature
    const variances = this.calculateVariance(vectors);

    // Sort features by variance (descending)
    const featureIndices = variances
      .map((variance, index) => ({ variance, index }))
      .sort((a, b) => b.variance - a.variance)
      .slice(0, targetDimensions)
      .map((item) => item.index);

    // Select top features
    return vectors.map((vector) =>
      featureIndices.map((index) => vector[index]),
    );
  }

  /**
   * Apply simple dimensionality reduction (mean-based)
   */
  private applySimpleReduction(
    vectors: number[][],
    targetDimensions: number,
  ): number[][] {
    if (vectors.length === 0 || vectors[0].length === 0) {
      return vectors;
    }

    const numFeatures = vectors[0].length;
    if (targetDimensions >= numFeatures) {
      return vectors;
    }

    // Group features and take means
    const groupSize = Math.ceil(numFeatures / targetDimensions);

    return vectors.map((vector) => {
      const reduced: number[] = [];
      for (let i = 0; i < targetDimensions; i++) {
        const startIdx = i * groupSize;
        const endIdx = Math.min((i + 1) * groupSize, numFeatures);
        const group = vector.slice(startIdx, endIdx);
        const mean = group.reduce((sum, val) => sum + val, 0) / group.length;
        reduced.push(mean);
      }
      return reduced;
    });
  }

  /**
   * Store vectorized data in MongoDB Atlas Vector Search and external vector databases
   */
  private async storeVectorizedData(
    vectors: number[][],
    metadata: any[],
    jobId: string,
  ): Promise<void> {
    try {
      const vectorDocuments = vectors.map((vector, index) => ({
        content: metadata[index]?.content || `Vectorized data ${index}`,
        contentType: metadata[index]?.contentType || 'telemetry',
        userId: metadata[index]?.userId,
        tenantId: metadata[index]?.tenantId,
        metadata: {
          ...metadata[index],
          jobId,
          vectorIndex: index,
          originalDimensions: metadata[index]?.originalDimensions,
        },
        vector,
        vectorizationStatus: 'completed' as const,
        vectorizationAttempts: 1,
        vectorizedAt: new Date(),
      }));

      // Save vectors to MongoDB Atlas Vector Search
      const savedDocuments =
        await this.vectorizationDocumentModel.insertMany(vectorDocuments);

      // Also save to external vector database if configured
      const vectorDbType = process.env.VECTOR_DB_TYPE;
      if (vectorDbType) {
        try {
          await this.storeToExternalVectorDB(savedDocuments, vectorDbType);
          this.logger.log(
            `Successfully stored vectors in external ${vectorDbType} database`,
            {
              jobId,
              vectorCount: vectors.length,
            },
          );
        } catch (externalError) {
          this.logger.warn(
            `Failed to store vectors in external ${vectorDbType} database, continuing with MongoDB only`,
            {
              jobId,
              error:
                externalError instanceof Error
                  ? externalError.message
                  : String(externalError),
            },
          );
        }
      }

      this.logger.log(
        `Successfully stored ${vectors.length} vectors in database for job ${jobId}`,
        {
          dimensions: vectors[0]?.length || 0,
          contentTypes: [...new Set(metadata.map((m) => m.contentType))],
          externalDb: vectorDbType || 'none',
        },
      );
    } catch (error) {
      this.logger.error('Failed to store vectorized data to database', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
        vectorCount: vectors.length,
      });
      throw error;
    }
  }

  /**
   * Store vectors to external vector database
   */
  private async storeToExternalVectorDB(
    documents: any[],
    vectorDbType: string,
  ): Promise<void> {
    const vectorOperations = documents.map(async (doc) => {
      switch (vectorDbType.toLowerCase()) {
        case 'pinecone':
          return this.storeToPinecone(doc);
        case 'weaviate':
          return this.storeToWeaviate(doc);
        case 'qdrant':
          return this.storeToQdrant(doc);
        case 'chroma':
          return this.storeToChroma(doc);
        default:
          this.logger.warn(`Unknown vector database type: ${vectorDbType}`);
          return Promise.resolve();
      }
    });

    await Promise.allSettled(vectorOperations);
  }

  /**
   * Store vector to Pinecone
   */
  private async storeToPinecone(doc: any): Promise<void> {
    const pineconeData = {
      id: doc._id.toString(),
      values: doc.vector,
      metadata: {
        contentType: doc.contentType,
        userId: doc.userId,
        tenantId: doc.tenantId,
        jobId: doc.metadata?.jobId,
        vectorizedAt: doc.vectorizedAt.toISOString(),
      },
    };

    await firstValueFrom(
      this.httpService.post(
        `${process.env.PINECONE_API_URL}/vectors/upsert`,
        {
          vectors: [pineconeData],
          namespace: process.env.PINECONE_NAMESPACE || 'default',
        },
        {
          headers: {
            'Api-Key': process.env.PINECONE_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Store vector to Weaviate
   */
  private async storeToWeaviate(doc: any): Promise<void> {
    const weaviateData = {
      class: 'VectorDocument',
      id: doc._id.toString(),
      properties: {
        contentType: doc.contentType,
        userId: doc.userId,
        tenantId: doc.tenantId,
        jobId: doc.metadata?.jobId,
        vectorizedAt: doc.vectorizedAt.toISOString(),
      },
      vector: doc.vector,
    };

    await firstValueFrom(
      this.httpService.post(
        `${process.env.WEAVIATE_URL}/v1/objects`,
        weaviateData,
        {
          headers: {
            Authorization: `Bearer ${process.env.WEAVIATE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Store vector to Qdrant
   */
  private async storeToQdrant(doc: any): Promise<void> {
    const qdrantData = {
      points: [
        {
          id: doc._id.toString(),
          vector: doc.vector,
          payload: {
            contentType: doc.contentType,
            userId: doc.userId,
            tenantId: doc.tenantId,
            jobId: doc.metadata?.jobId,
            vectorizedAt: doc.vectorizedAt.toISOString(),
          },
        },
      ],
    };

    await firstValueFrom(
      this.httpService.put(
        `${process.env.QDRANT_URL}/collections/${process.env.QDRANT_COLLECTION}/points`,
        qdrantData,
        {
          headers: {
            'api-key': process.env.QDRANT_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Store vector to Chroma
   */
  private async storeToChroma(doc: any): Promise<void> {
    const chromaData = {
      ids: [doc._id.toString()],
      embeddings: [doc.vector],
      metadatas: [
        {
          contentType: doc.contentType,
          userId: doc.userId,
          tenantId: doc.tenantId,
          jobId: doc.metadata?.jobId,
          vectorizedAt: doc.vectorizedAt.toISOString(),
        },
      ],
      documents: [doc.content],
    };

    await firstValueFrom(
      this.httpService.post(
        `${process.env.CHROMA_URL}/api/v1/collections/${process.env.CHROMA_COLLECTION}/add`,
        chromaData,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  // Helper methods for linear algebra operations

  private calculateMean(vectors: number[][]): number[] {
    const numFeatures = vectors[0].length;
    const mean = new Array(numFeatures).fill(0);

    for (const vector of vectors) {
      for (let i = 0; i < numFeatures; i++) {
        mean[i] += vector[i];
      }
    }

    return mean.map((sum) => sum / vectors.length);
  }

  private centerData(vectors: number[][], mean: number[]): number[][] {
    return vectors.map((vector) => vector.map((val, idx) => val - mean[idx]));
  }

  private calculateCovariance(vectors: number[][]): number[][] {
    const numFeatures = vectors[0].length;
    const covariance = Array.from({ length: numFeatures }, () =>
      new Array(numFeatures).fill(0),
    );

    for (const vector of vectors) {
      for (let i = 0; i < numFeatures; i++) {
        for (let j = 0; j < numFeatures; j++) {
          covariance[i][j] += vector[i] * vector[j];
        }
      }
    }

    const n = vectors.length - 1; // Bessel's correction
    for (let i = 0; i < numFeatures; i++) {
      for (let j = 0; j < numFeatures; j++) {
        covariance[i][j] /= n;
      }
    }

    return covariance;
  }

  private computeEigenvectors(
    covariance: number[][],
    numComponents: number,
  ): number[][] {
    const size = covariance.length;
    if (size === 0) return [];

    try {
      const result = math.eigs(covariance, {
        eigenvectors: true,
        precision: 1e-9,
      });
      const eigenVectors = result.eigenvectors as Array<{
        value: number;
        vector: number[];
      }>;
      if (!eigenVectors || eigenVectors.length === 0) {
        return this.fallbackPowerIteration(covariance, numComponents);
      }
      // Eigenvalues sorted by absolute value ascending; take top numComponents (largest)
      const sorted = [...eigenVectors].sort(
        (a, b) => Math.abs(b.value) - Math.abs(a.value),
      );
      return sorted
        .slice(0, numComponents)
        .map((ev) =>
          Array.isArray(ev.vector) ? [...ev.vector] : [...(ev.vector as any)],
        );
    } catch {
      return this.fallbackPowerIteration(covariance, numComponents);
    }
  }

  private fallbackPowerIteration(
    covariance: number[][],
    numComponents: number,
  ): number[][] {
    const eigenvectors: number[][] = [];
    const size = covariance.length;
    for (let k = 0; k < numComponents; k++) {
      // Use standard basis vector e_k for deterministic, reproducible PCA.
      // Power iteration converges to dominant eigenvector; deterministic init avoids
      // non-deterministic embeddings that would pollute the vector store.
      let vector = Array.from(
        { length: size },
        (_, i) => (i === k % size ? 1 : 0),
      );
      for (let iter = 0; iter < 15; iter++) {
        const newVector = new Array(size).fill(0);
        for (let i = 0; i < size; i++) {
          for (let j = 0; j < size; j++) {
            newVector[i] += covariance[i][j] * vector[j];
          }
        }
        const norm = Math.sqrt(
          newVector.reduce((sum, val) => sum + val * val, 0),
        );
        vector = norm > 1e-12 ? newVector.map((val) => val / norm) : vector;
      }
      eigenvectors.push([...vector]);
    }
    return eigenvectors;
  }

  private calculateVariance(vectors: number[][]): number[] {
    const numFeatures = vectors[0].length;
    const variances = new Array(numFeatures).fill(0);

    // Calculate mean for each feature
    const mean = this.calculateMean(vectors);

    // Calculate variance
    for (const vector of vectors) {
      for (let i = 0; i < numFeatures; i++) {
        const diff = vector[i] - mean[i];
        variances[i] += diff * diff;
      }
    }

    return variances.map((sum) => sum / (vectors.length - 1)); // Bessel's correction
  }

  /**
   * Clean up old completed jobs (older than 7 days)
   */
  async cleanupOldJobs(): Promise<void> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const result = await this.vectorizationJobModel
        .deleteMany({
          status: { $in: ['completed', 'failed', 'cancelled'] },
          endTime: { $lt: sevenDaysAgo },
        })
        .exec();

      this.logger.log('Cleaned up old vectorization jobs', {
        deletedCount: result.deletedCount,
        cutoffDate: sevenDaysAgo,
      });
    } catch (error) {
      this.logger.error('Error cleaning up old jobs:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'BackgroundVectorizationService',
        operation: 'cleanupOldJobs',
      });
    }
  }
}
