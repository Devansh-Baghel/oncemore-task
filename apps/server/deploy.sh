#!/usr/bin/env bash
set -euo pipefail

# Deploy helper for App Engine Standard (monorepo workaround)
# Bun uses `catalog:` and `workspace:*` which `npm` on GAE cannot parse.
# This script:
# 1. builds dist/ via turbo (bundles @oncemore/*)
# 2. swaps package.json to a GAE-compatible version (no catalog/workspace)
# 3. deploys via gcloud app deploy
# 4. restores original package.json

PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null)}"
if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: ./deploy.sh [PROJECT_ID]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Building..."
(cd "$ROOT_DIR" && bun run build)

echo "Backing up package.json..."
cp "$SCRIPT_DIR/package.json" /tmp/package.json.dev.bak

echo "Writing GAE-compatible package.json..."
cat > "$SCRIPT_DIR/package.json" <<'JSON'
{
	"name": "server",
	"type": "module",
	"engines": { "node": "22.x" },
	"scripts": { "start": "node dist/index.mjs" },
	"dependencies": {
		"@ai-sdk/openai-compatible": "^3.0.40",
		"ai": "^7.0.84",
		"cors": "^2.8.6",
		"dotenv": "^17.4.2",
		"express": "^5.2.1",
		"zod": "^4.4.3"
	}
}
JSON

cleanup() {
  echo "Restoring original package.json..."
  cp /tmp/package.json.dev.bak "$SCRIPT_DIR/package.json" || true
}
trap cleanup EXIT

echo "Deploying to $PROJECT_ID..."
gcloud app deploy "$SCRIPT_DIR/app.yaml" --project="$PROJECT_ID" --quiet

echo "Deployed to https://$PROJECT_ID.el.r.appspot.com"
echo "Logs: gcloud app logs tail -s default --project=$PROJECT_ID"
