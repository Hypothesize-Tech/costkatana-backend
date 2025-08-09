    FROM node:20-slim AS builder

    WORKDIR /app
    
    # Build deps for native modules
    RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        python3-pip \
        pkg-config \
      && rm -rf /var/lib/apt/lists/*
    
    # Install deps (use ci if lockfile exists; install also works)
    COPY package*.json ./
    ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
    ENV PYTHON=/usr/bin/python3
    RUN npm ci || npm install
    
    # Copy source and build
    COPY . .
    RUN npm run build
    
    # Keep only production deps for the final image
    RUN npm prune --omit=dev && npm cache clean --force
    
    # --- Production stage ---
    FROM node:20-slim
    
    WORKDIR /app
    
    # Runtime deps for Puppeteer + native addons
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
        libgomp1 \
        lsb-release \
        wget \
        xdg-utils \
      && rm -rf /var/lib/apt/lists/*
    
    # Non-root user
    RUN addgroup --gid 1001 nodejs && \
        adduser --uid 1001 --gid 1001 --shell /bin/bash --disabled-password nodejs
    
    # Copy built app and production node_modules from builder
    COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
    COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
    COPY --chown=nodejs:nodejs package*.json ./
    
    # App env
    ENV NODE_ENV=production
    ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
    ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
    
    # Logs dir
    RUN mkdir -p logs && chown nodejs:nodejs logs
    
    USER nodejs
    EXPOSE 8000
    
    ENTRYPOINT ["dumb-init", "--"]
    CMD ["node", "dist/server.js"]
    