# Vector Pipeline Architecture

## Overview

The vector pipeline powers semantic search across Cost Katana's knowledge base, code repositories, and conversation history. It uses a layered architecture with multiple storage backends, hybrid search, and optional reranking.

## Pipeline Stages

### Stage 1: Document Processing

```
Raw Documents → Chunking → Metadata Enrichment → Embedding Generation → Storage
```

- **Chunking**: Documents split into semantically meaningful chunks (configurable size, overlap)
- **Metadata Enrichment**: AST parsing for code (function/class names, language, file path, lines)
- **Embedding**: AWS Bedrock embeddings via `SafeBedrockEmbeddingsService`
- **Storage**: Dual-write to MongoDB (source of truth) and vector index (FAISS or LangChain HNSW)

### Stage 2: Index Strategy

The `VectorStrategyService` routes reads based on configuration:

| Phase | Primary | Fallback | Use Case |
|-------|---------|----------|----------|
| A     | MongoDB | —        | Default; LangChain vector store |
| B     | MongoDB | —        | Shadow read (both FAISS + MongoDB, log divergence) |
| C     | FAISS   | MongoDB  | FAISS primary with graceful degradation |

FAISS indices:
- **Global index**: knowledge-base, telemetry, activity
- **Per-user index**: conversation, user-upload

### Stage 3: Search Execution

#### Dense Search (Vector)
- FAISS: `similaritySearchWithScore()` with configurable k and score threshold
- LangChain: Cosine similarity or MMR with fetchK, lambda
- Filters: `repoFullName`, `language`, `chunkType`, `userId`, `status: active`

#### Sparse Search (BM25)
- Term-frequency based keyword search
- Complements dense search for exact matches
- `SparseSearchService` with configurable options

#### Hybrid Search
- Runs sparse and dense **in parallel**
- **Reciprocal Rank Fusion (RRF)**: Merges rankings with `k=60`
- Weights: sparse (0.4), dense (0.6) by default
- Output: Deduplicated `HybridSearchResult[]` with `chunkId`, `content`, `score`, `sparseScore`, `denseScore`, `metadata`

### Stage 4: Reranking (Optional)

- **RerankerService**: Improves ordering of hybrid results
- **Scoring**: Cross-encoder style or LLM-based (Claude) for top candidates
- **Top-K**: Returns configured number of best results (default: 50)

### Stage 5: RAG Orchestration

For knowledge-base queries, the Modular RAG Orchestrator:

1. **Pattern Selection**: Naive, Adaptive, Iterative, or Recursive based on query analysis
2. **Retrieve**: Fetches documents via vector strategy (ingestion pipeline)
3. **Generate**: Sends query + context to Bedrock LLM
4. **Evaluate** (optional): RAGAS-aligned metrics (faithfulness, relevance, context precision)

## RAG Pattern Types

| Pattern   | Description                    | Best For                    |
|-----------|--------------------------------|-----------------------------|
| Naive     | Single retrieve + generate     | Simple factual questions    |
| Adaptive  | Query analysis → strategy      | Mixed complexity            |
| Iterative | Multi-round refinement         | Complex, multi-step queries  |
| Recursive | Hierarchical decomposition     | Deep technical questions    |

## Semantic Cache (Inline)

When enabled, before LLM calls:
1. Generate embedding for prompt
2. Check for exact hash match
3. Search cache for similar prompts (embedding similarity ≥ threshold)
4. On hit: return cached response, skip LLM (70-80% cost savings)
5. On miss: call LLM, store in cache with TTL

## Health & Recovery

- **VectorHealthService**: Monitors index integrity
- **VectorRecoveryService**: Rebuilds indices from source data
- **Sentinel Documents**: Special markers for index validation; filtered from search results

## Performance Considerations

- **Parallel execution**: Sparse + dense search run concurrently
- **Batch writes**: VectorWriteQueueService for async, batched index updates
- **LRU cache**: FAISS service uses in-memory cache for indices
- **Score threshold**: Filter low-relevance results at search layer
