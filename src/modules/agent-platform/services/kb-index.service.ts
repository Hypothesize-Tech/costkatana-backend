import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  AgentKbChunk,
  AgentKbChunkDocument,
} from '../../../schemas/agent-platform/agent-kb-chunk.schema';

interface FaissIndexHandle {
  add: (vec: number[]) => void;
  search: (vec: number[], k: number) => { distances: number[]; labels: number[] };
  ntotal: () => number;
}

interface IndexEntry {
  index: FaissIndexHandle;
  chunkIds: string[]; // ordered to align with FAISS labels
  dimension: number;
  builtAt: Date;
}

const INDEX_TTL_MS = 10 * 60 * 1000; // refresh every 10 min just in case

/**
 * Per-knowledge-base FAISS index, lazy-built from Mongo and cached
 * in-memory. Uses `IndexFlatIP` over L2-normalized vectors == cosine
 * similarity. Falls back to pure-JS cosine if `faiss-node` fails to
 * load (some Node ABI mismatches break the native binding).
 */
@Injectable()
export class KbIndexService {
  private readonly logger = new Logger(KbIndexService.name);
  private readonly indexes = new Map<string, IndexEntry>();
  private faissAvailable = false;
  private FaissModule: any = null;

  constructor(
    @InjectModel(AgentKbChunk.name)
    private readonly chunkModel: Model<AgentKbChunkDocument>,
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.FaissModule = require('faiss-node');
      this.faissAvailable = true;
      this.logger.log('faiss-node loaded — using FAISS for vector search');
    } catch (err) {
      this.faissAvailable = false;
      this.logger.warn(
        `faiss-node not available (${err instanceof Error ? err.message : 'unknown'}) — falling back to in-memory cosine.`,
      );
    }
  }

  /** Drop the cached index for a kb so the next query rebuilds it. */
  invalidate(knowledgeBaseId: string): void {
    this.indexes.delete(knowledgeBaseId);
  }

  /**
   * Returns the top-k chunks for a query vector. Loads / rebuilds the
   * FAISS index for this kb if needed.
   */
  async search(
    knowledgeBaseId: string,
    queryVector: number[],
    k: number,
  ): Promise<
    Array<{ chunkId: string; score: number; text: string; source: string; ordinal: number }>
  > {
    const kbId = String(knowledgeBaseId);
    const indexEntry = await this.getOrBuild(kbId);
    if (!indexEntry || indexEntry.chunkIds.length === 0) return [];

    const topK = Math.min(k, indexEntry.chunkIds.length);
    const orderedChunkIdScores: Array<{ chunkId: string; score: number }> = [];

    if (this.faissAvailable && indexEntry.index) {
      const { distances, labels } = indexEntry.index.search(queryVector, topK);
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        if (label < 0 || label >= indexEntry.chunkIds.length) continue;
        orderedChunkIdScores.push({
          chunkId: indexEntry.chunkIds[label],
          score: distances[i], // IP on normalized vectors == cosine similarity
        });
      }
    } else {
      // Fallback: brute-force cosine in JS. Only fires when faiss-node fails
      // to load (rare). Acceptable up to a few thousand chunks.
      const chunks = await this.chunkModel
        .find({ knowledgeBaseId: new Types.ObjectId(kbId) })
        .select('_id vector')
        .lean();
      const scored = chunks.map((c) => ({
        chunkId: String(c._id),
        score: dot(queryVector, c.vector as unknown as number[]),
      }));
      scored.sort((a, b) => b.score - a.score);
      for (const s of scored.slice(0, topK)) orderedChunkIdScores.push(s);
    }

    if (orderedChunkIdScores.length === 0) return [];

    // Hydrate text + source for the chunk ids the index returned. We do this
    // in one query rather than per-result.
    const ids = orderedChunkIdScores.map((s) => new Types.ObjectId(s.chunkId));
    const docs = await this.chunkModel
      .find({ _id: { $in: ids } })
      .select('text source ordinal')
      .lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));

    return orderedChunkIdScores
      .map((s) => {
        const d = byId.get(s.chunkId);
        if (!d) return null;
        return {
          chunkId: s.chunkId,
          score: s.score,
          text: d.text,
          source: d.source,
          ordinal: d.ordinal,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  // ──────────────────────── private ────────────────────────

  private async getOrBuild(kbId: string): Promise<IndexEntry | null> {
    const existing = this.indexes.get(kbId);
    if (existing && Date.now() - existing.builtAt.getTime() < INDEX_TTL_MS) {
      return existing;
    }

    const chunks = await this.chunkModel
      .find({ knowledgeBaseId: new Types.ObjectId(kbId) })
      .select('_id vector dimension')
      .sort({ _id: 1 })
      .lean();

    if (!chunks.length) {
      this.indexes.delete(kbId);
      return null;
    }

    const dimension = chunks[0].dimension ?? chunks[0].vector.length;
    const chunkIds = chunks.map((c) => String(c._id));

    let index: FaissIndexHandle | null = null;
    if (this.faissAvailable && this.FaissModule?.IndexFlatIP) {
      try {
        const idx = new this.FaissModule.IndexFlatIP(dimension);
        for (const c of chunks) {
          const vec = c.vector as unknown as number[];
          if (vec.length !== dimension) continue;
          idx.add(vec);
        }
        index = idx;
      } catch (err) {
        this.logger.warn(
          `FAISS index build failed (${err instanceof Error ? err.message : String(err)}); falling back to JS cosine for this kb.`,
        );
        index = null;
      }
    }

    const entry: IndexEntry = {
      index: index ?? (null as unknown as FaissIndexHandle),
      chunkIds,
      dimension,
      builtAt: new Date(),
    };
    this.indexes.set(kbId, entry);
    return entry;
  }
}

function dot(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}
