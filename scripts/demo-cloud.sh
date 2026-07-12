#!/usr/bin/env bash
# Local DX demo: exercises the full loop -- self-hosted ctxhub instance -> Cloud sync ->
# Mission Control's Cloud/Groups panels -- against docker-compose.cloud.yml, with no real
# cloud account, Entra tenant, or hosting decision required.
#
# Usage:
#   docker compose -f docker-compose.cloud.yml up -d --build
#   scripts/demo-cloud.sh
#
# What it does:
#   1. Registers a demo org against the running Cloud service (admin key from the compose file)
#   2. Scaffolds a local ctxhub workspace with `ctxhub demo` (sample docs, indexed, two chunks
#      promoted to institutional tier)
#   3. Points that workspace's cloud config at the local Cloud service
#   4. Runs `ctxhub cloud sync` -- pushes promoted chunks AND captain run history
#   5. Verifies via `ctxhub cloud status` and a direct GET /cloud/history call that the data
#      actually landed, so this is a real assertion, not just "the commands didn't error"
#
# Still true after this script passes: the Cloud service is in-memory only (data doesn't
# survive `docker compose down`), and none of this has been run against a real Entra tenant,
# real VF3 credentials, or a deployed (non-Docker) Cloud instance.

set -euo pipefail

CTXHUB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLOUD_URL="http://localhost:3001"
CLOUD_ADMIN_KEY="local-dev-admin-key"
DEMO_HOME="$(mktemp -d -t ctxhub-cloud-demo-home-XXXXXX)"
DEMO_WORKSPACE_DIR="$(mktemp -d -t ctxhub-cloud-demo-ws-XXXXXX)"

cleanup() {
  rm -rf "$DEMO_HOME" "$DEMO_WORKSPACE_DIR"
}
trap cleanup EXIT

export CTXHUB_HOME="$DEMO_HOME"
CLI="node $CTXHUB_DIR/dist/index.js"

echo "== 1. Checking Cloud service is reachable =="
if ! curl -sf "$CLOUD_URL/health" > /dev/null; then
  echo "Cloud service not reachable at $CLOUD_URL"
  echo "Start it first: docker compose -f docker-compose.cloud.yml up -d --build"
  exit 1
fi
echo "OK"

echo ""
echo "== 2. Registering a demo org =="
ORG_SLUG="demo-org-$(date +%s)"
ORG_API_KEY="demo-org-key-$(date +%s)"
ORG_RESPONSE=$(curl -sf -X POST "$CLOUD_URL/orgs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLOUD_ADMIN_KEY" \
  -d "{\"name\":\"Demo Org\",\"slug\":\"$ORG_SLUG\",\"orgApiKey\":\"$ORG_API_KEY\"}")
echo "$ORG_RESPONSE"

echo ""
echo "== 3. Scaffolding a local ctxhub demo workspace =="
cd "$DEMO_WORKSPACE_DIR"
$CLI demo --force

echo ""
echo "== 4. Configuring Cloud sync =="
$CLI cloud configure --endpoint "$CLOUD_URL" --api-key "$ORG_API_KEY"

echo ""
echo "== 5. Running a captain task so there's run history to sync =="
$CLI captain add demo-task --workspace ctxhub-demo --query "What does this workspace do?"
$CLI captain run demo-task

echo ""
echo "== 6. Syncing to Cloud (chunks + captain runs) =="
$CLI cloud sync

echo ""
echo "== 7. Verifying via ctxhub cloud status =="
$CLI cloud status

echo ""
echo "== 8. Verifying via a direct GET /cloud/history call =="
HISTORY=$(curl -sf "$CLOUD_URL/sync/history?limit=10" -H "Authorization: Bearer $ORG_API_KEY")
echo "$HISTORY"

RUNS_COUNT=$(node -e "console.log(JSON.parse(process.argv[1]).runs.length)" "$HISTORY")
if [ "$RUNS_COUNT" -gt 0 ]; then
  echo ""
  echo "✓ Demo passed: $RUNS_COUNT captain run(s) landed in Cloud and are queryable via /sync/history."
  echo "  Open Mission Control locally and point it at this workspace to see it in the Cloud panel."
else
  echo ""
  echo "✗ No captain runs found in Cloud history -- something in the sync chain didn't work."
  exit 1
fi
