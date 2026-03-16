# Cost Katana Backend (NestJS) - Dockerfile
# Multi-stage build for production

FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (if needed later)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 6144 MB for build - GitHub ubuntu-latest has ~7GB; type-check disabled in build:docker
ENV NODE_OPTIONS="--max-old-space-size=6144"

# Install dependencies (--legacy-peer-deps for @langchain/community pdf-parse peer conflict)
COPY package*.json .npmrc ./
RUN npm ci --prefer-offline --no-audit --legacy-peer-deps || \
    (echo "npm ci failed, trying npm install..." && npm install --prefer-offline --no-audit --legacy-peer-deps)

# Copy source and build (build:docker skips type-check to reduce memory; typeCheck runs in CI)
COPY . .
RUN npm run build:docker

# Production deps only
RUN npm prune --production && npm cache clean --force

# --- Production stage ---
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --gid 1001 nodejs && \
    adduser --uid 1001 --gid 1001 --shell /bin/bash --disabled-password nodejs

# Copy built app and production node_modules from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Optional: copy docs and knowledge-base for reference (e.g. RAG later)
COPY --chown=nodejs:nodejs API_DOCUMENTATION.md ./
COPY --chown=nodejs:nodejs README.md ./
COPY --chown=nodejs:nodejs docs/ ./docs/
COPY --chown=nodejs:nodejs knowledge-base/ ./knowledge-base/

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Create writable directories for runtime (nodejs user needs write access)
RUN mkdir -p logs uploads uploads/templates uploads/temp context-files data/faiss && \
    chown -R nodejs:nodejs logs uploads context-files data

USER nodejs
EXPOSE 8000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
