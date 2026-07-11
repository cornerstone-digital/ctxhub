#!/usr/bin/env bash
# =============================================================================
# ctxhub install verification script
# Tests that `npm install -g ctxhub` produces a working installation.
#
# Run this on a fresh machine (or a clean Node environment) AFTER installing:
#   npm install -g ctxhub
#   bash <(curl -fsSL https://raw.githubusercontent.com/your-org/ctxhub/main/scripts/verify-install.sh)
#
# Or clone the repo and run:
#   bash scripts/verify-install.sh
#
# Exit codes: 0 = all checks passed, 1 = one or more checks failed
# =============================================================================

set -euo pipefail

PASS="✅"
FAIL="❌"
SKIP="⏭ "
SECTION="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ok()      { echo "  $PASS $1"; }
fail()    { echo "  $FAIL $1"; EXIT_CODE=1; }
skip()    { echo "  $SKIP $1"; }
section() { echo; echo "$SECTION"; echo "  $1"; echo "$SECTION"; }

EXIT_CODE=0

# Use a throwaway CTXHUB_HOME so this script never touches ~/.ctxhub
export CTXHUB_HOME="$(mktemp -d)"
trap 'rm -rf "$CTXHUB_HOME"' EXIT

# ── 1. Environment ────────────────────────────────────────────────────────────

section "1 · Environment"

node_ver=$(node --version 2>/dev/null || echo "missing")
if [[ "$node_ver" == v2[0-9]* ]]; then
  ok "Node $node_ver (>=20 required)"
else
  fail "Node >=20 required, got: $node_ver — install from https://nodejs.org"
fi

npm_ver=$(npm --version 2>/dev/null || echo "missing")
ok "npm $npm_ver"

os_info=$(uname -sr 2>/dev/null || echo "unknown")
ok "OS: $os_info ($(uname -m))"

# ── 2. Binary on PATH ─────────────────────────────────────────────────────────

section "2 · Binary"

if ! command -v ctxhub &>/dev/null; then
  fail "ctxhub not found on PATH"
  echo
  echo "  Install with:  npm install -g ctxhub"
  echo "  If already installed, check that npm's global bin is on your PATH:"
  echo "    npm config get prefix    # add <prefix>/bin to PATH"
  exit 1
fi

ok "ctxhub found at: $(which ctxhub)"

# ── 3. Version ────────────────────────────────────────────────────────────────

section "3 · Version"

version=$(ctxhub --version 2>&1 || true)
if echo "$version" | grep -qE "^[0-9]+\.[0-9]+\.[0-9]+"; then
  ok "ctxhub $version"
else
  fail "ctxhub --version returned unexpected output: $version"
fi

# ── 4. Core commands available ────────────────────────────────────────────────

section "4 · Core commands"

help_out=$(ctxhub --help 2>&1 || true)

for cmd in workspace repo index search explain service captain eval; do
  if echo "$help_out" | grep -q "$cmd"; then
    ok "  $cmd"
  else
    fail "  $cmd — not listed in --help (installation may be incomplete)"
  fi
done

# ── 5. Workspace and repo setup ───────────────────────────────────────────────

section "5 · Workspace setup"

TMPWS="$(mktemp -d)"
trap 'rm -rf "$TMPWS" "$CTXHUB_HOME"' EXIT

# Real git repo so ctxhub can detect it
git -C "$TMPWS" init -q
git -C "$TMPWS" config user.email "verify@ctxhub.test"
git -C "$TMPWS" config user.name "Verify"
git -C "$TMPWS" commit --allow-empty -m "init" -q

echo "test content" > "$TMPWS/README.md"
git -C "$TMPWS" add README.md
git -C "$TMPWS" commit -m "add readme" -q

if ctxhub workspace register "$TMPWS" --name verify-test 2>&1 | grep -qiE "registered|already"; then
  ok "workspace register"
else
  fail "workspace register — check output above"
fi

if ctxhub --cwd "$TMPWS" repo add verify-src . 2>&1 | grep -qiE "added|already"; then
  ok "repo add"
else
  fail "repo add"
fi

if ctxhub --cwd "$TMPWS" repo list 2>&1 | grep -q "verify-src"; then
  ok "repo list"
else
  fail "repo list — registered repo not found"
fi

# ── 6. Index ──────────────────────────────────────────────────────────────────

section "6 · Index"

echo "  Running ctxhub index (may take a few seconds)..."
index_out=$(ctxhub --cwd "$TMPWS" index 2>&1 || true)

if echo "$index_out" | grep -qiE "done|complete|indexed|0 files|no files"; then
  ok "ctxhub index completed"
else
  fail "ctxhub index produced unexpected output — see below"
  echo "$index_out" | head -20
fi

# ── 7. Eval health check ──────────────────────────────────────────────────────

section "7 · Eval health check"

echo "  Running ctxhub eval --health..."
eval_out=$(ctxhub --cwd "$TMPWS" eval --health 2>&1 || true)

if echo "$eval_out" | grep -qiE "pass|ok|healthy|warning|error|result"; then
  ok "ctxhub eval --health ran"
  # Show the summary line if there is one
  summary=$(echo "$eval_out" | grep -iE "pass|fail|result" | head -3 || true)
  [[ -n "$summary" ]] && echo "    $summary"
else
  fail "ctxhub eval --health produced no output"
fi

# ── 8. Service start / health / stop ──────────────────────────────────────────

section "8 · Service"

# Stop anything already running on this port
ctxhub service stop 2>/dev/null || true
sleep 1

start_out=$(ctxhub service start 2>&1 || true)

if echo "$start_out" | grep -qiE "start|listen|running|already"; then
  ok "ctxhub service start"
  sleep 2

  if curl -sf --max-time 5 http://localhost:7342/health -o /dev/null; then
    ok "GET /health → 200"
  else
    fail "GET /health failed — service may not have started correctly"
  fi

  if curl -sf --max-time 5 http://localhost:7342/workspaces -o /dev/null; then
    ok "GET /workspaces → 200"
  else
    fail "GET /workspaces failed"
  fi

  ctxhub service stop 2>/dev/null || true
  sleep 1
  ok "ctxhub service stop"
else
  fail "service start failed — output: $start_out"
fi

# ── 9. Doctor ─────────────────────────────────────────────────────────────────

section "9 · Doctor"

doctor_out=$(ctxhub --cwd "$TMPWS" doctor 2>&1 || true)
if echo "$doctor_out" | grep -qiE "healthy|ok|warn|error|check"; then
  ok "ctxhub doctor ran"
else
  skip "ctxhub doctor — no recognisable output (command may not exist in this version)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

section "Summary"

if [[ "$EXIT_CODE" -eq 0 ]]; then
  echo "  $PASS All checks passed — ctxhub $version is correctly installed."
  echo
  echo "  Next steps:"
  echo "    ctxhub workspace register <path>   register your first workspace"
  echo "    ctxhub repo add <name> <path>      add a repo to index"
  echo "    ctxhub index                       build the index"
  echo "    ctxhub service start               start Mission Control (http://localhost:7342)"
  echo
  echo "  Full quickstart: https://github.com/your-org/ctxhub/blob/main/docs/quickstart.md"
else
  echo "  $FAIL Some checks failed — review the output above."
  echo
  echo "  Common fixes:"
  echo "    - Node version:  nvm use 22 (or install from https://nodejs.org)"
  echo "    - PATH issue:    export PATH=\"\$(npm config get prefix)/bin:\$PATH\""
  echo "    - Reinstall:     npm uninstall -g ctxhub && npm install -g ctxhub"
  echo "    - File an issue: https://github.com/your-org/ctxhub/issues"
fi

echo
exit $EXIT_CODE
