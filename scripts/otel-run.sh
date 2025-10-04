#!/bin/bash

# OpenTelemetry Collector Run Script for Cost Katana
# Starts the OTel Collector as a background process

set -e

# Configuration
INSTALL_DIR="./bin"
BINARY_NAME="otelcol-contrib"
CONFIG_FILE="ops/observability/otel-collector-config.yaml"
PIDFILE="/tmp/costkatana-otel-collector.pid"
LOGFILE="logs/otel-collector.log"
ENV_FILE=".env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if collector is installed
check_installation() {
    if [ ! -f "$INSTALL_DIR/$BINARY_NAME" ]; then
        log_error "OTel Collector not found at $INSTALL_DIR/$BINARY_NAME"
        log_info "Please run 'npm run otel:install' first"
        exit 1
    fi
    
    if [ ! -x "$INSTALL_DIR/$BINARY_NAME" ]; then
        log_error "OTel Collector binary is not executable"
        chmod +x "$INSTALL_DIR/$BINARY_NAME"
        log_info "Fixed binary permissions"
    fi
}

# Check configuration file
check_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        log_error "Configuration file not found at $CONFIG_FILE"
        exit 1
    fi
    
    # Validate configuration
    log_info "Validating configuration..."
    "$INSTALL_DIR/$BINARY_NAME" validate --config="$CONFIG_FILE" > /dev/null 2>&1 || {
        log_error "Configuration validation failed"
        log_info "Run the following command to see detailed errors:"
        log_info "  $INSTALL_DIR/$BINARY_NAME validate --config=$CONFIG_FILE"
        exit 1
    }
    log_info "Configuration is valid"
}

# Check if already running
check_running() {
    if [ -f "$PIDFILE" ]; then
        PID=$(cat "$PIDFILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            log_warn "OTel Collector is already running with PID: $PID"
            log_info "Use 'npm run otel:stop' to stop it first"
            exit 1
        else
            log_info "Removing stale PID file"
            rm -f "$PIDFILE"
        fi
    fi
}

# Load environment variables
load_env() {
    if [ -f "$ENV_FILE" ]; then
        log_info "Loading environment variables from $ENV_FILE"
        set -a
        source "$ENV_FILE"
        set +a
    else
        log_warn "No .env file found, using default configuration"
    fi
    
    # Set default values if not provided
    export ENVIRONMENT=${NODE_ENV:-development}
    export OTLP_HTTP_ENDPOINT=${OTLP_HTTP_TRACES_URL:-http://localhost:4318}
    export OTLP_INSECURE=${OTLP_INSECURE:-true}
    export LOG_LEVEL=${LOG_LEVEL:-info}
    
    # Display configuration
    log_info "Configuration:"
    log_info "  Environment: $ENVIRONMENT"
    log_info "  OTLP Endpoint: $OTLP_HTTP_ENDPOINT"
    log_info "  Log Level: $LOG_LEVEL"
}

# Create log directory if needed
create_log_dir() {
    LOG_DIR=$(dirname "$LOGFILE")
    if [ ! -d "$LOG_DIR" ]; then
        log_info "Creating log directory: $LOG_DIR"
        mkdir -p "$LOG_DIR"
    fi
}

# Start the collector
start_collector() {
    log_info "Starting OTel Collector..."
    
    # Start collector in background
    nohup "$INSTALL_DIR/$BINARY_NAME" \
        --config="$CONFIG_FILE" \
        > "$LOGFILE" 2>&1 &
    
    PID=$!
    
    # Wait a moment to check if it started successfully
    sleep 2
    
    if ps -p "$PID" > /dev/null; then
        echo "$PID" > "$PIDFILE"
        log_info "OTel Collector started successfully"
        log_info "  PID: $PID"
        log_info "  Log file: $LOGFILE"
        log_info "  PID file: $PIDFILE"
        
        # Display service endpoints
        echo
        log_info "Service endpoints:"
        log_info "  OTLP gRPC: localhost:4317"
        log_info "  OTLP HTTP: localhost:4318"
        log_info "  Prometheus metrics: localhost:9464/metrics"
        log_info "  Health check: localhost:13133/health"
        log_info "  zPages (debug): localhost:55679/debug/tracez"
        
        # Show initial log output
        echo
        log_info "Initial log output:"
        tail -n 20 "$LOGFILE"
        
        # Check health endpoint
        sleep 2
        check_health
    else
        log_error "Failed to start OTel Collector"
        log_error "Check the log file for details: $LOGFILE"
        if [ -f "$LOGFILE" ]; then
            tail -n 50 "$LOGFILE"
        fi
        exit 1
    fi
}

# Check collector health
check_health() {
    if command -v curl &> /dev/null; then
        HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:13133/health || echo "000")
        if [ "$HEALTH_CHECK" = "200" ]; then
            log_info "Health check passed ✓"
        else
            log_warn "Health check returned: $HEALTH_CHECK"
        fi
    else
        log_warn "curl not available, skipping health check"
    fi
}

# Display monitoring commands
show_monitoring_commands() {
    echo
    echo "=========================================="
    echo "  Monitoring Commands"
    echo "=========================================="
    echo
    echo "View logs:"
    echo "  tail -f $LOGFILE"
    echo
    echo "Check status:"
    echo "  ps -p \$(cat $PIDFILE)"
    echo
    echo "Check health:"
    echo "  curl http://localhost:13133/health"
    echo
    echo "View metrics:"
    echo "  curl http://localhost:9464/metrics"
    echo
    echo "Debug traces (zPages):"
    echo "  open http://localhost:55679/debug/tracez"
    echo
    echo "Stop collector:"
    echo "  npm run otel:stop"
    echo
}

# Main execution
main() {
    echo "=========================================="
    echo "  Starting Cost Katana OTel Collector"
    echo "=========================================="
    echo
    
    check_installation
    check_config
    check_running
    load_env
    create_log_dir
    start_collector
    show_monitoring_commands
}

# Run main function
main "$@"
