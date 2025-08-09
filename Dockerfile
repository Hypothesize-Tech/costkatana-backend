# Use a Debian-based image for better compatibility with native modules
# --- Build stage ---
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    pip && \
    rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
# Use npm install instead of ci for more resilience, and skip Chromium download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PYTHON python3
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the application
RUN npm run build

# --- Production stage ---
FROM node:20-slim

WORKDIR /app

# Install system dependencies for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    # Use the system-provided chromium
    chromium \
    # Additional dependencies for chromium
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
    xdg-utils && \
    rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN addgroup --gid 1001 nodejs && \
    adduser --uid 1001 --gid 1001 --shell /bin/bash --disabled-password nodejs

# Copy package files and install production dependencies
COPY package*.json ./
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PYTHON python3
RUN npm install --omit=dev && npm cache clean --force

# Copy built application from the builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Create logs directory and set permissions
RUN mkdir -p logs && chown nodejs:nodejs logs

# Switch to the non-root user
USER nodejs

# Expose the application port
EXPOSE 8000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/server.js"]