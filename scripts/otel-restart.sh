#!/bin/bash

# Cost Katana OpenTelemetry Collector Restart Script

set -e

echo "=========================================="
echo "  Restarting Cost Katana OTel Collector"
echo "=========================================="

# Stop the collector
echo "[INFO] Stopping existing collector..."
npm run otel:stop

# Wait a moment
sleep 2

# Start the collector
echo "[INFO] Starting collector..."
npm run otel:run

echo "[INFO] Restart complete."
