#!/bin/bash

# OpenTelemetry Collector Installation Script for Cost Katana
# Downloads and installs the OTel Collector Contrib binary

set -e

# Configuration
OTEL_VERSION="0.96.0"
INSTALL_DIR="./bin"
BINARY_NAME="otelcol-contrib"
PIDFILE="/tmp/costkatana-otel-collector.pid"

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

# Detect OS and architecture
detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    case "$OS" in
        linux)
            PLATFORM="linux"
            ;;
        darwin)
            PLATFORM="darwin"
            ;;
        *)
            log_error "Unsupported OS: $OS"
            exit 1
            ;;
    esac
    
    case "$ARCH" in
        x86_64|amd64)
            ARCHITECTURE="amd64"
            ;;
        aarch64|arm64)
            ARCHITECTURE="arm64"
            ;;
        *)
            log_error "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac
    
    log_info "Detected platform: $PLATFORM/$ARCHITECTURE"
}

# Create installation directory
create_install_dir() {
    if [ ! -d "$INSTALL_DIR" ]; then
        log_info "Creating installation directory: $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi
}

# Check if collector is already installed
check_existing_installation() {
    if [ -f "$INSTALL_DIR/$BINARY_NAME" ]; then
        CURRENT_VERSION=$("$INSTALL_DIR/$BINARY_NAME" --version 2>/dev/null | head -n1 || echo "unknown")
        log_warn "OTel Collector already installed: $CURRENT_VERSION"
        
        read -p "Do you want to reinstall? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Installation cancelled"
            exit 0
        fi
    fi
}

# Download OTel Collector
download_collector() {
    local DOWNLOAD_URL="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTEL_VERSION}/otelcol-contrib_${OTEL_VERSION}_${PLATFORM}_${ARCHITECTURE}.tar.gz"
    local TEMP_FILE="/tmp/otelcol-contrib.tar.gz"
    
    log_info "Downloading OTel Collector v${OTEL_VERSION}..."
    log_info "URL: $DOWNLOAD_URL"
    
    if command -v curl &> /dev/null; then
        curl -L -o "$TEMP_FILE" "$DOWNLOAD_URL" || {
            log_error "Failed to download OTel Collector"
            exit 1
        }
    elif command -v wget &> /dev/null; then
        wget -O "$TEMP_FILE" "$DOWNLOAD_URL" || {
            log_error "Failed to download OTel Collector"
            exit 1
        }
    else
        log_error "Neither curl nor wget is available. Please install one of them."
        exit 1
    fi
    
    log_info "Download complete"
}

# Extract and install
install_collector() {
    local TEMP_FILE="/tmp/otelcol-contrib.tar.gz"
    local TEMP_DIR="/tmp/otelcol-extract"
    
    log_info "Extracting OTel Collector..."
    
    # Create temporary extraction directory
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    
    # Extract
    tar -xzf "$TEMP_FILE" -C "$TEMP_DIR" || {
        log_error "Failed to extract OTel Collector"
        exit 1
    }
    
    # Move binary to installation directory
    if [ -f "$TEMP_DIR/otelcol-contrib" ]; then
        mv "$TEMP_DIR/otelcol-contrib" "$INSTALL_DIR/$BINARY_NAME"
    else
        log_error "Binary not found in extracted files"
        exit 1
    fi
    
    # Make executable
    chmod +x "$INSTALL_DIR/$BINARY_NAME"
    
    # Cleanup
    rm -f "$TEMP_FILE"
    rm -rf "$TEMP_DIR"
    
    log_info "Installation complete"
}

# Verify installation
verify_installation() {
    if [ ! -f "$INSTALL_DIR/$BINARY_NAME" ]; then
        log_error "Installation verification failed: binary not found"
        exit 1
    fi
    
    # Check if binary is executable
    if [ ! -x "$INSTALL_DIR/$BINARY_NAME" ]; then
        log_error "Binary is not executable"
        exit 1
    fi
    
    # Try to get version
    VERSION=$("$INSTALL_DIR/$BINARY_NAME" --version 2>/dev/null | head -n1 || echo "unknown")
    log_info "OTel Collector installed successfully"
    log_info "Version: $VERSION"
    log_info "Location: $INSTALL_DIR/$BINARY_NAME"
}

# Create default config if it doesn't exist
setup_default_config() {
    CONFIG_FILE="ops/observability/otel-collector-config.yaml"
    
    if [ ! -f "$CONFIG_FILE" ]; then
        log_warn "Configuration file not found at $CONFIG_FILE"
        log_info "Please ensure the configuration file exists before running the collector"
    else
        log_info "Configuration file found at: $CONFIG_FILE"
    fi
}

# Check for running instance
check_running_instance() {
    if [ -f "$PIDFILE" ]; then
        PID=$(cat "$PIDFILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            log_warn "OTel Collector is already running with PID: $PID"
            log_info "Use './scripts/otel-stop.sh' to stop it first"
        else
            log_info "Removing stale PID file"
            rm -f "$PIDFILE"
        fi
    fi
}

# Main installation flow
main() {
    echo "=========================================="
    echo "  Cost Katana OTel Collector Installer"
    echo "=========================================="
    echo
    
    detect_platform
    create_install_dir
    check_existing_installation
    download_collector
    install_collector
    verify_installation
    setup_default_config
    check_running_instance
    
    echo
    echo "=========================================="
    echo "  Installation Complete!"
    echo "=========================================="
    echo
    echo "Next steps:"
    echo "1. Review the configuration at: ops/observability/otel-collector-config.yaml"
    echo "2. Set environment variables in .env file"
    echo "3. Run the collector: npm run otel:run"
    echo "4. Stop the collector: npm run otel:stop"
    echo
    echo "For direct execution:"
    echo "  Start: $INSTALL_DIR/$BINARY_NAME --config ops/observability/otel-collector-config.yaml"
    echo
}

# Run main function
main "$@"
