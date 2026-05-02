#!/usr/bin/env bash
# Build the AXON widget loader into a single minified JS file ready for CDN.
#
# Output:
#   widget-loader/dist/widget.js       — minified
#   widget-loader/dist/widget.js.map   — source map
#
# Requires: esbuild (npx esbuild …, no global install needed).

set -euo pipefail

cd "$(dirname "$0")"

mkdir -p dist

npx --yes esbuild widget.js \
  --bundle \
  --minify \
  --target=es2018 \
  --format=iife \
  --legal-comments=none \
  --sourcemap \
  --outfile=dist/widget.js

size=$(wc -c < dist/widget.js | tr -d ' ')
sha=$(shasum -a 256 dist/widget.js | awk '{print $1}')

echo ""
echo "Built dist/widget.js"
echo "  size: ${size} bytes"
echo "  sha:  ${sha}"
echo ""
echo "Run \`bash widget-loader/deploy.sh\` to publish to"
echo "  s3://${AWS_S3_BUCKET:-costkatana-media}/agent-platform/widget/widget.js"
