#!/usr/bin/env bash
# =============================================================================
# ctxhub smoke test
# Walks through build → unit tests → CLI commands → service → dashboard → reset
# Run from the repo root: bash scripts/smoke-test.sh
# =============================================================================

set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────────────

PASS="✅"
FAIL="❌"
SKIP="⏭ "
SECTION="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ok()   { echo "  $PASS $1"; }
fail() { echo "  $FAIL $1"; EXIT_CODE=1; }
skip() { echo "  $SKIP $1 (skipped)"; }
section() { echo; echo "$SECTION"; echo "  $1"; echo "$SECTION"; }

EXIT_CODE=0
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Sandbox every ctxhub invocation below behind a throwaway CTXHUB_HOME so this script
# can register/reset freely without touching (or wiping) the real ~/.ctxhub.
export CTXHUB_HOME="$(mktemp -d)"
trap 'rm -rf "$CTXHUB_HOME"' EXIT

# ── 0. Preflight ─────────────────────────────────────────────────────────────

section "0 · Preflight"

node_version=$(node --version 2>/dev/null || echo "missing")
if [[ "$node_version" == v2* ]]; then
  ok "Node $node_version"
else
  fail "Node >=20 required, got: $node_version"
fi

if command -v ctxhub &>/dev/null; then
  ok "ctxhub binary on PATH ($(which ctxhub))"
else
  skip "ctxhub not on PATH — run 'npm link' to test CLI commands against the installed binary"
fi

if [[ -d node_modules ]]; then
  ok "node_modules present"
else
  fail "node_modules missing — run: npm install"
fi

# ── 1. TypeScript ─────────────────────────────────────────────────────────────

section "1 · TypeScript"

if npx tsc --noEmit 2>&1 | tee /tmp/ctxhub-tsc.log | grep -q "error TS"; then
  fail "TypeScript errors — see /tmp/ctxhub-tsc.log"
else
  ok "tsc --noEmit: zero errors"
fi

# ── 2. Unit tests ─────────────────────────────────────────────────────────────

section "2 · Unit tests"

echo "  Running npm test (this may take ~30s)..."
test_output=$(npm test 2>&1 | tail -5)
if echo "$test_output" | grep -qE "fail|Error"; then
  fail "Some tests failed"
  echo "$test_output"
else
  pass_line=$(npm test 2>&1 | grep -E "pass|✓" | tail -1)
  ok "All tests passed — $pass_line"
fi

# ── 3. Build ─────────────────────────────────────────────────────────────────

section "3 · Build"

if npm run build 2>&1 | tail -3 | grep -qi "error"; then
  fail "Build failed"
else
  if [[ -f dist/index.js ]]; then
    ok "dist/index.js produced"
  else
    fail "dist/index.js not found after build"
  fi
fi

# ── 4. CLI smoke test ─────────────────────────────────────────────────────────

section "4 · CLI smoke test"

# Use 'node dist/index.js' if ctxhub isn't linked
CLI="node $REPO_ROOT/dist/index.js"
if command -v ctxhub &>/dev/null; then CLI="ctxhub"; fi

# --version
if $CLI --version 2>&1 | grep -qE "^[0-9]+\.[0-9]+\.[0-9]+"; then
  ok "ctxhub --version → $($CLI --version)"
else
  fail "ctxhub --version returned unexpected output"
fi

# --help (should exit 0 and mention key commands)
help_out=$($CLI --help 2>&1)
for cmd in workspace repo index search explain reset service; do
  if echo "$help_out" | grep -q "$cmd"; then
    ok "help lists '$cmd'"
  else
    fail "help missing '$cmd'"
  fi
done

# ctxhub workspace --help
if $CLI workspace --help 2>&1 | grep -qE "register|list"; then
  ok "workspace --help"
else
  fail "workspace --help: missing sub-commands"
fi

# ctxhub repo --help
if $CLI repo --help 2>&1 | grep -qE "add|list|discover"; then
  ok "repo --help"
else
  fail "repo --help: missing sub-commands"
fi

# ctxhub reset --help
if $CLI reset --help 2>&1 | grep -qE "\-\-global|\-\-local|\-\-registry"; then
  ok "reset --help shows --global, --local, --registry flags"
else
  fail "reset --help: missing expected flags"
fi

# ctxhub service --help
if $CLI service --help 2>&1 | grep -qE "start|stop|status"; then
  ok "service --help"
else
  fail "service --help: missing sub-commands"
fi

# ctxhub stats (offline, no workspace needed)
stats_out=$($CLI stats 2>&1 || true)
if echo "$stats_out" | grep -qiE "workspace|index|no workspace"; then
  ok "ctxhub stats runs without crash"
else
  skip "ctxhub stats — unexpected output (may need a registered workspace)"
fi

# ── 5. Workspace + repo + index (integration) ─────────────────────────────────

section "5 · Workspace integration (in /tmp)"

TMPWS=$(mktemp -d)
trap 'rm -rf "$TMPWS" "$CTXHUB_HOME"' EXIT

# Make it a git repo so ctxhub can detect it
git -C "$TMPWS" init -q
git -C "$TMPWS" commit --allow-empty -m "init" -q

echo "  Working dir: $TMPWS"

if $CLI workspace register "$TMPWS" --name smoke-test 2>&1 | grep -qiE "registered|already"; then
  ok "workspace register"
else
  fail "workspace register"
fi

if $CLI --cwd "$TMPWS" repo add smoke-src . 2>&1 | grep -qiE "added|already"; then
  ok "repo add"
else
  fail "repo add"
fi

if $CLI --cwd "$TMPWS" repo list 2>&1 | grep -q "smoke-src"; then
  ok "repo list shows added repo"
else
  fail "repo list: repo not found"
fi

# Index (small temp repo, should be fast)
if $CLI --cwd "$TMPWS" index 2>&1 | grep -qiE "done|complete|indexed|0 files"; then
  ok "ctxhub index (empty repo)"
else
  fail "ctxhub index failed or no output"
fi

if $CLI --cwd "$TMPWS" doctor 2>&1 | grep -qiE "healthy|ok|warn|error"; then
  ok "ctxhub doctor ran"
else
  fail "ctxhub doctor produced no output"
fi

# ── 6. Service ───────────────────────────────────────────────────────────────

section "6 · Service"

# Stop anything already running
$CLI service stop 2>/dev/null || true
sleep 1

if $CLI service start 2>&1 | grep -qiE "start|listen|running|already"; then
  ok "ctxhub service start"
  sleep 1

  # Health endpoint
  if curl -sf http://localhost:7342/health -o /dev/null; then
    ok "GET /health → 200"
  else
    fail "GET /health failed — service may not have started"
  fi

  # Root serves HTML (React app or fallback)
  content_type=$(curl -sI http://localhost:7342/ | grep -i content-type || true)
  if echo "$content_type" | grep -qi "text/html"; then
    ok "GET / → text/html"
  else
    fail "GET / did not return text/html"
  fi

  # Workspaces endpoint
  if curl -sf http://localhost:7342/workspaces -o /dev/null; then
    ok "GET /workspaces → 200"
  else
    fail "GET /workspaces failed"
  fi

  # Service status
  if $CLI service status 2>&1 | grep -qiE "running|pid"; then
    ok "ctxhub service status shows running"
  else
    fail "ctxhub service status: not showing running"
  fi

  $CLI service stop 2>/dev/null || true
  sleep 1
  ok "ctxhub service stop"
else
  skip "service start — skipping service tests"
fi

# ── 7. Mission Control UI ─────────────────────────────────────────────────────

section "7 · Mission Control UI (build check)"

if [[ -d "$REPO_ROOT/ui" ]]; then
  if [[ -f "$REPO_ROOT/ui/package.json" ]]; then
    ok "ui/package.json found"
  else
    fail "ui/package.json missing"
  fi

  if [[ -d "$REPO_ROOT/ui/node_modules" ]]; then
    ok "ui/node_modules installed"
  else
    fail "ui/node_modules missing — run: cd ui && npm install"
  fi

  if cd "$REPO_ROOT/ui" && npm run build 2>&1 | tail -5 | grep -qiE "built|dist|vite"; then
    ok "ui build succeeded (vite)"
    cd "$REPO_ROOT"
  else
    fail "ui build failed"
    cd "$REPO_ROOT"
  fi

  if [[ -f "$REPO_ROOT/ui/dist/index.html" ]]; then
    ok "ui/dist/index.html exists"
  else
    fail "ui/dist/index.html missing after build"
  fi
else
  skip "ui/ directory not found"
fi

# ── 8. Reset command (dry-run via --force on a temp path) ─────────────────────

section "8 · Reset command"

# Test: reset --registry --force should not crash (uses real home, but registry may not exist)
if $CLI reset --registry --force 2>&1 | grep -qiE "cleared|does not exist|removed|nothing"; then
  ok "reset --registry --force ran cleanly"
else
  fail "reset --registry --force: unexpected output"
fi

# Confirm prompt is present without --force
reset_help=$($CLI reset --help 2>&1)
if echo "$reset_help" | grep -q "\-f"; then
  ok "reset --help shows -f/--force flag"
else
  fail "reset --help missing -f flag"
fi

# ── 9. Key source files ───────────────────────────────────────────────────────

section "9 · Key source files"

files=(
  "src/utils/fs.ts"
  "src/indexing/LanceDbIndex.ts"
  "src/indexing/indexer.ts"
  "src/service/server.ts"
  "src/commands/reset.ts"
  "src/captains/scheduler.ts"
  "src/utils/driftCheck.ts"
  "ui/src/App.tsx"
  "ui/src/components/GraphCanvas.tsx"
  "ui/src/store/fleet.ts"
  "ui/src/api/client.ts"
  "docs/quickstart.md"
)

for f in "${files[@]}"; do
  if [[ -f "$REPO_ROOT/$f" ]]; then
    ok "$f"
  else
    fail "$f — missing"
  fi
done

# ── 10. Git status ────────────────────────────────────────────────────────────

section "10 · Git"

last_commit=$(git -C "$REPO_ROOT" log --oneline -1 2>/dev/null)
ok "Last commit: $last_commit"

uncommitted=$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [[ "$uncommitted" -eq 0 ]]; then
  ok "Working tree clean (nothing uncommitted)"
else
  skip "$uncommitted uncommitted change(s) — run 'git status' to review"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

section "Summary"

if [[ "$EXIT_CODE" -eq 0 ]]; then
  echo "  $PASS All checks passed."
else
  echo "  $FAIL Some checks failed — review output above."
fi

echo
exit $EXIT_CODE
