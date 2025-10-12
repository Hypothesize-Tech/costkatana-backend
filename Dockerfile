FROM node:20-slim AS builder

WORKDIR /app

# Build deps for native modules including hnswlib-node
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    python3-pip \
    pkg-config \
    cmake \
    make \
    g++ \
    gcc \
    libc6-dev \
    libstdc++6 \
    libgomp1 \
  && rm -rf /var/lib/apt/lists/*

# Set environment for native module compilation
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PYTHON=/usr/bin/python3
ENV npm_config_build_from_source=true
ENV npm_config_cache=/tmp/.npm
ENV CXX=g++
ENV CC=gcc

# Install dependencies
COPY package*.json ./
RUN npm ci || npm install

# Rebuild native modules specifically for this container architecture
RUN npm rebuild hnswlib-node --build-from-source || echo "Warning: hnswlib-node rebuild failed"

# Copy source and build TypeScript
COPY . .
RUN npm run build

# Keep only production deps for the final image
RUN npm prune --omit=dev && npm cache clean --force
    
    # --- Production stage ---
    FROM node:20-slim
    
    WORKDIR /app
    
# Runtime deps for Puppeteer + native addons + hnswlib-node
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    # Critical runtime dependencies for hnswlib-node
    libgomp1 \
    libstdc++6 \
  && rm -rf /var/lib/apt/lists/*
    
    # Non-root user
    RUN addgroup --gid 1001 nodejs && \
        adduser --uid 1001 --gid 1001 --shell /bin/bash --disabled-password nodejs
    
# Copy built app and production node_modules from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs package*.json ./

# Copy documentation files for vector store
COPY --chown=nodejs:nodejs API_DOCUMENTATION.md ./
COPY --chown=nodejs:nodejs README.md ./
COPY --chown=nodejs:nodejs docs/ ./docs/
COPY --chown=nodejs:nodejs knowledge-base/ ./knowledge-base/

# Install build tools temporarily for rebuilding native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    cmake \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Rebuild hnswlib-node for this container's architecture
RUN npm rebuild hnswlib-node --build-from-source && \
    echo "✅ hnswlib-node rebuilt successfully in production stage"

# Remove build tools to keep image small
RUN apt-get purge -y build-essential python3 cmake g++ && \
    apt-get autoremove -y && \
    apt-get clean
    
# App env
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Redis connection settings
ENV REDIS_CONNECTION_TIMEOUT=5000
ENV REDIS_RETRY_DELAY=1000
ENV REDIS_MAX_RETRIES=3
    
    # Logs dir
    RUN mkdir -p logs && chown nodejs:nodejs logs
    
    USER nodejs
    EXPOSE 8000
    
    ENTRYPOINT ["dumb-init", "--"]
    CMD ["node", "dist/server.js"]
    