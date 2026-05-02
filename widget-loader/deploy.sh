#!/usr/bin/env bash
# Deploy the agent widget loader to the existing `costkatana-media` S3 bucket.
#
# Reads AWS_S3_BUCKET / AWS_REGION from the environment (or falls back to
# `costkatana-media` / `us-east-1`). No new bucket required.
#
# Usage:
#   bash widget-loader/deploy.sh             # builds + uploads
#   bash widget-loader/deploy.sh --skip-build  # uploads existing dist/widget.js
#
# Requires: aws cli, esbuild (auto-installed via npx in build.sh).

set -euo pipefail

cd "$(dirname "$0")"

BUCKET="${AWS_S3_BUCKET:-costkatana-media}"
REGION="${AWS_REGION:-us-east-1}"
KEY="agent-platform/widget/widget.js"

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "Building widget bundle…"
  bash ./build.sh
fi

if [[ ! -f dist/widget.js ]]; then
  echo "ERROR: dist/widget.js not found — run build first." >&2
  exit 1
fi

echo "Uploading to s3://${BUCKET}/${KEY} (region: ${REGION})…"

aws s3 cp dist/widget.js "s3://${BUCKET}/${KEY}" \
  --region "${REGION}" \
  --cache-control "public, max-age=300" \
  --content-type "application/javascript" \
  --acl public-read

if [[ -f dist/widget.js.map ]]; then
  aws s3 cp dist/widget.js.map "s3://${BUCKET}/${KEY}.map" \
    --region "${REGION}" \
    --cache-control "public, max-age=300" \
    --content-type "application/json" \
    --acl public-read
fi

cat <<EOF

Done. The widget is live at:
  https://${BUCKET}.s3.${REGION}.amazonaws.com/${KEY}
  https://${BUCKET}.s3.amazonaws.com/${KEY}        (us-east-1 short form)

Embed snippet:
  <script src="https://${BUCKET}.s3.amazonaws.com/${KEY}" data-deployment-id="dep_xxxxxxxx" defer></script>

If the bucket is fronted by CloudFront, swap the URL with your distribution
domain (e.g. https://cdn.costkatana.ai/widget.js) — no other code change.
EOF
