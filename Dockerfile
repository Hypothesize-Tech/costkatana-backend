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

ENV NODE_OPTIONS="--max-old-space-size=4096"

# Install dependencies
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit || \
    (echo "npm ci failed, trying npm install..." && npm install --prefer-offline --no-audit)

# Copy source and build
COPY . .
RUN npm run build

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

RUN mkdir -p logs && chown nodejs:nodejs logs

USER nodejs
EXPOSE 8000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
