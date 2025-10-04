#!/bin/bash

# OpenTelemetry Collector Stop Script for Cost Katana
# Gracefully stops the running OTel Collector process

set -e

# Configuration
PIDFILE="/tmp/costkatana-otel-collector.pid"
LOGFILE="logs/otel-collector.log"

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

# Check if collector is running
check_running() {
    if [ ! -f "$PIDFILE" ]; then
        log_warn "PID file not found at $PIDFILE"
        log_info "OTel Collector is not running (or was not started using otel-run.sh)"
        
        # Try to find process anyway
        PIDS=$(pgrep -f "otelcol-contrib.*otel-collector-config.yaml" || true)
        if [ -n "$PIDS" ]; then
            log_warn "Found OTel Collector process(es): $PIDS"
            log_info "These processes were not started by this script"
            read -p "Do you want to stop them anyway? (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                for PID in $PIDS; do
                    stop_process "$PID"
                done
            fi
        fi
        return 1
    fi
    
    PID=$(cat "$PIDFILE")
    if ! ps -p "$PID" > /dev/null 2>&1; then
        log_warn "Process $PID is not running"
        log_info "Removing stale PID file"
        rm -f "$PIDFILE"
        return 1
    fi
    
    return 0
}

# Stop a process gracefully
stop_process() {
    local PID=$1
    
    log_info "Stopping OTel Collector (PID: $PID)..."
    
    # Send SIGTERM for graceful shutdown
    kill -TERM "$PID" 2>/dev/null || {
        log_error "Failed to send SIGTERM to process $PID"
        return 1
    }
    
    # Wait for process to stop (max 30 seconds)
    local COUNT=0
    while [ $COUNT -lt 30 ]; do
        if ! ps -p "$PID" > /dev/null 2>&1; then
            log_info "Process stopped successfully"
            return 0
        fi
        sleep 1
        COUNT=$((COUNT + 1))
        
        # Show progress
        if [ $((COUNT % 5)) -eq 0 ]; then
            log_info "Waiting for process to stop... ($COUNT seconds)"
        fi
    done
    
    # If still running, force kill
    if ps -p "$PID" > /dev/null 2>&1; then
        log_warn "Process did not stop gracefully, forcing termination..."
        kill -KILL "$PID" 2>/dev/null || {
            log_error "Failed to force kill process $PID"
            return 1
        }
        sleep 1
        
        if ! ps -p "$PID" > /dev/null 2>&1; then
            log_info "Process forcefully terminated"
        else
            log_error "Failed to stop process $PID"
            return 1
        fi
    fi
    
    return 0
}

# Clean up PID file
cleanup() {
    if [ -f "$PIDFILE" ]; then
        log_info "Removing PID file"
        rm -f "$PIDFILE"
    fi
}

# Show last logs
show_last_logs() {
    if [ -f "$LOGFILE" ]; then
        log_info "Last 20 lines from log file:"
        echo "----------------------------------------"
        tail -n 20 "$LOGFILE"
        echo "----------------------------------------"
    fi
}

# Check for any remaining collector processes
check_remaining_processes() {
    REMAINING=$(pgrep -f "otelcol-contrib" || true)
    if [ -n "$REMAINING" ]; then
        log_warn "Found remaining OTel Collector processes: $REMAINING"
        log_info "You may need to manually stop these processes:"
        ps -p "$REMAINING" -o pid,cmd
    else
        log_info "No remaining OTel Collector processes found"
    fi
}

# Main execution
main() {
    echo "=========================================="
    echo "  Stopping Cost Katana OTel Collector"
    echo "=========================================="
    echo
    
    if check_running; then
        PID=$(cat "$PIDFILE")
        if stop_process "$PID"; then
            cleanup
            log_info "OTel Collector stopped successfully"
            show_last_logs
        else
            log_error "Failed to stop OTel Collector"
            exit 1
        fi
    else
        log_info "OTel Collector is not running"
    fi
    
    echo
    check_remaining_processes
    
    echo
    echo "=========================================="
    echo "  Shutdown Complete"
    echo "=========================================="
    echo
}

# Handle script interruption
trap 'log_warn "Script interrupted"; exit 1' INT TERM

# Run main function
main "$@"
