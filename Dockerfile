# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    py3-pip \
    libc6-compat

# Copy package files and install dependencies to leverage Docker cache
COPY package*.json ./
RUN npm ci

# Copy the rest of the source code
COPY . .

# Build the application
RUN npm run build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

# Install production dependencies for native modules and Puppeteer
# This includes Chromium dependencies for Alpine
RUN apk add --no-cache \
    dumb-init \
    python3 \
    make \
    g++ \
    py3-pip \
    libc6-compat \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont

# Create a non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 nodejs

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application from the builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Create logs directory and set permissions
RUN mkdir -p logs && chown nodejs:nodejs logs

# Switch to the non-root user
USER nodejs

# Expose the application port
EXPOSE 8000

# Use dumb-init to handle signals properly, ensuring graceful shutdown
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/server.js"]