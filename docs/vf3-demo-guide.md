# How to demo ctxhub to VF3

Internal guide for anyone running a technical demo with the VodafoneThree Engineering team.
This is a 20–30 minute session, probably with the CTO and members of the cyber/security team.
Read the whole thing before the meeting. Run the setup steps the day before.

---

## Setup (do this before the meeting)

### Prerequisites

- Node 20 or 22: `node --version`
- ctxhub installed: `npm install -g ctxhub` (or `npm install -g .` from the repo root if running from source)
- Microsoft Entra ID tenant (test or production — see the VF3 design partner notes in `docs/strategy/`)
- A terminal and a browser open and visible

### Scaffold the demo workspace

```bash
ctxhub demo
```

This creates `~/.ctxhub/demo-workspace/` with six realistic technical documentation files,
indexes them, promotes two chunks, and seeds Mission Control with a connected demo scenario:
knowledge objects, Captain tasks and completed runs, organisation sharing, custom roles, a
multi-step job, timeline events, and 14 days of usage data. It makes no external model calls.
Use `ctxhub demo --force` to reset the demo-owned records before a repeatable Playwright or
promo-video run; unrelated records in the global stores are preserved. Takes about 10 seconds.

To record the scripted 90-second Mission Control promo in an isolated environment:

```bash
npm run demo:record
```

The recorder requires an authenticated `codex` CLI on `PATH`; it enables Codex only inside its
disposable workspace and fails if Chat falls back to retrieval-only output. The finished
1920×1080 WebM is written to `docs/videos/mission-control-promo.webm`. Use
`npm run demo:record:smoke` to exercise the complete route at accelerated pacing without
waiting for the full recording. Smoke output is written separately to
`docs/videos/mission-control-promo-smoke.webm` and may use the evidence fallback when every
configured LLM route is unavailable; it never overwrites the production promo.

Verify the workspace is registered:

```bash
ctxhub workspace list
```

You should see `ctxhub-demo` in the list.

### Start the service

```bash
ctxhub service start --port 7342
```

The service starts as a background process and logs to `~/.ctxhub/service.log`.
Open the Mission Control dashboard to confirm it's running:

```bash
ctxhub dashboard --port 7342
```

The browser should open to `http://localhost:7342`. Leave this tab open — you'll
switch to it during Act 2.

### Configure Entra ID (for the SSO demo in Act 2)

If you haven't already configured auth for this machine:

```bash
ctxhub auth configure \
  --tenant-id <vf3-tenant-id> \
  --client-id <app-registration-client-id> \
  --client-secret <client-secret>
```

Store the values in 1Password (or your team's secrets manager). Don't paste them raw
into a terminal session you're going to screen-share.

### Run the health check

```bash
ctxhub doctor --enterprise
```

Everything should be green. If anything is red, fix it before the meeting starts.
The `--enterprise` flag runs additional checks: auth configured, session valid, role map,
groups store, index populated.

### Have these ready

- A second terminal window open and pre-typed with the demo commands (so you can run them fast)
- The Mission Control browser tab open but minimised
- A note with the chunk IDs you'll promote (run `ctxhub chunk list --min-tier unverified` ahead of time)

---

## Demo script (~20 minutes)

### Act 1: The problem (3 minutes)

**Story to tell:**

"A developer joins a new engineering team. Before they can touch anything meaningful,
they spend their first two weeks trawling 12 repositories, three wikis, and a Confluence
space that hasn't been touched since 2021. The architectural decisions — why PostgreSQL,
how auth works, what the deployment process is — are scattered across ADRs nobody reads,
runbooks nobody links to, and Slack messages that have long since scrolled past.

ctxhub is the knowledge layer that makes that information findable in seconds."

**Run the first search:**

```bash
ctxhub search "how does authentication work"
```

Point out:
- Results appear immediately — no API call, no cloud round-trip
- The top result cites the exact ADR that made the JWT/OIDC decision
- The source file is shown alongside the content snippet

**Key point to make:**

"This is running entirely locally. Nothing left this machine. There's no cloud service
involved in that search. The index is on the local filesystem."

---

### Act 2: Enterprise control (10 minutes)

This is the section the security team will care about most. Take your time here.

**Login via Entra SSO:**

```bash
ctxhub login
```

A browser tab opens, the user authenticates against the VF3 Entra ID tenant,
the callback completes, and the terminal confirms the session.

```bash
ctxhub auth status
```

Show the output: user identity, Entra tenant ID, and the assigned ctxhub role (owner).

**Explain the role model:**

"ctxhub has five roles: owner, admin, member, reader, machine. Roles are resolved
from your Entra ID group memberships at login time. You configure the group-to-role
mapping once, and then user access follows your existing identity infrastructure.
No separate user database."

**Promote a key document:**

Take the chunk ID from `adr-002-auth.md` — the JWT/OIDC decision, which ties directly
into the SSO story you just walked through. (`adr-001-database.md` and the deploy
runbook are already promoted by `ctxhub demo` setup, so promoting either of those live
would be a no-op — pick the auth ADR instead, since it's still unverified.)

```bash
ctxhub chunk list --min-tier unverified
```

Copy the ID for the ADR-002 chunk, then:

```bash
ctxhub chunk promote <chunk-id> --tier institutional --reason "Core architecture decision — approved for cross-org sharing" --by "demo"
```

Explain:
"This is the 'captain approval' moment. An institutional chunk is one that a human
has explicitly decided is safe and authoritative enough to share across org boundaries.
Only institutional and canonical chunks cross the org boundary in a Corporate Group.
The rest stays local."

**Show the corporate group sharing matrix:**

```bash
ctxhub group status --group-id <group-id>
```

Or, in Mission Control: switch to the Groups panel.
Point out the sharing matrix — which orgs can read from which, and at what trust tier.

**Show live audit events in Mission Control:**

Switch to the browser. In the Events / Timeline panel, the chunk promotion event
you just ran should appear within a second or two (live SSE stream).

"Every auth event, every chunk promotion, every captain approval — it's all in an
append-only audit log. If your security team wants to pipe this to a SIEM, the JSONL
file is at `~/.ctxhub/events.jsonl` by default, or you can point a log shipper at it."

**Cross-workspace search:**

```bash
ctxhub search "database" --all-workspaces
```

Show the results annotated with workspace names. If you have more than one workspace
registered, this demonstrates the cross-workspace fan-out.

---

### Act 3: Integration story (7 minutes)

**MCP integration:**

"ctxhub exposes all of this as a Model Context Protocol server. Claude, Cursor, Codex —
any AI coding tool that speaks MCP can pull context from ctxhub during a conversation.
When a developer asks Claude 'how does our auth system work', Claude calls the ctxhub
search tool, gets the ADR and architecture doc as context, and gives an answer grounded
in your actual documentation — not a hallucination."

Show the MCP config being written:

```bash
ctxhub agent claude --no-launch
```

This writes the MCP config to the Claude Desktop config file. The developer just
restarts Claude and ctxhub is wired in.

**Webhook for auto-reindex:**

```bash
ctxhub webhook set-secret "demo-secret-$(date +%s)"
```

"When a developer pushes a commit, a git post-commit hook calls ctxhub's webhook endpoint.
The index updates automatically. No manual `ctxhub index` required. The knowledge base
stays current without anyone thinking about it."

Show the hook installation:

```bash
ctxhub repo hook demo-docs
```

**Cloud sync (dry run):**

```bash
ctxhub cloud sync --dry-run
```

The output shows how many institutional and canonical chunks would sync to the cloud
endpoint. Nothing actually moves — `--dry-run` is just a count.

"Cloud sync is opt-in. By default, ctxhub is 100% local. When your org is ready
to share institutional knowledge across the VF3 group — Vodafone UK, Three UK, Voxi —
you configure the cloud endpoint and run `ctxhub cloud sync`. Only institutional
and canonical tier chunks move. Unverified documents never leave the local machine."

**Close:**

"ctxhub is the knowledge layer between your codebase and your AI tools. It's local-first,
enterprise-governed, and designed to compound: the more your team uses it, the more
useful it becomes. The knowledge doesn't live in any one person's head or any one
conversation history — it's indexed, versioned, and auditable."

---

## Questions to expect

### "How does this work with GitHub Copilot?"

ctxhub exposes an MCP server. Copilot doesn't natively speak MCP today, but it does
support VS Code extensions. The integration path is via the ctxhub VS Code extension
(on the roadmap, not yet released). In the meantime, the MCP server works with
Claude Code, Cursor, and any other tool with MCP support.

The practical answer for VF3 today: if they're using Cursor or Claude Code, ctxhub
works natively. If they're on Copilot exclusively, the integration is on the roadmap.

### "Can we self-host?"

Yes. The deployment model is single-tenant by design. Docker Compose and Helm charts
are in `docs/deploy/SELF_HOSTED.md`. The service runs in their own Kubernetes cluster
or on a VM — nothing touches ctxhub-managed infrastructure unless they opt in to
cloud sync, and even then they configure their own endpoint.

"Your source code never leaves your machines. That's not a policy commitment — it's
an architectural constraint. There's no call home, no telemetry, no SaaS endpoint
that indexes your code. We can audit this together if your security team wants."

### "What data leaves the machine?"

Nothing, by default. The index is on the local filesystem. Search runs locally.
Captains run locally. The audit log is local.

The only data that moves externally:
1. If `llm.enabled: true` in config and a Captain or `ctxhub explain` call runs —
   the indexed chunk content is sent to the configured LLM provider (OpenAI-compatible
   endpoint; can be a self-hosted model). This is opt-in and the user configures the endpoint.
2. If cloud sync is configured and the user runs `ctxhub cloud sync` — institutional
   and canonical chunks are pushed to the configured cloud endpoint. Opt-in, user-controlled endpoint.

The auth flow sends credentials to the configured Entra ID tenant (their own tenant),
not to ctxhub infrastructure.

### "GDPR / data residency?"

Fully local by default — data doesn't leave the machine or the org's network.
Cloud sync, when used, targets an endpoint the org configures. In a VF3 deployment,
that endpoint would be in their own UK infrastructure, not a third-party cloud.

For EU data residency compliance: the local deployment model means ctxhub processes
data where the developer's machine is. For server-based deployments (via Docker Compose
or Helm), the data resides in the cluster — wherever the org chooses to run it.

The VF3 Entra ID integration means user identity is resolved against VF3's own
Microsoft tenant; ctxhub never stores passwords or credentials.

### "How does it handle secrets?"

Two layers:

1. **`.ctxhubignore`**: patterns in this file are never indexed. The default includes
   `.env`, `.env.*`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, and a `secrets/` directory.
   These patterns are always applied — even without a `.ctxhubignore` file.

2. **Redaction patterns**: configurable regex patterns in `ctxhub.yaml` (the `privacy.redactPatterns`
   section). Any content matching these patterns is redacted before it reaches the index.
   The default patterns catch common secret formats: `api_key = abc123`, AWS access key
   patterns, PEM-format private keys.

If a developer accidentally commits a secret and it gets indexed, `ctxhub reset --local`
clears the index and a `ctxhub index --force` rebuilds it clean.

---

## Fallback demos (if the live environment breaks)

If the service won't start, or indexing fails, or auth is broken:

**CLI-only fallback (no service needed):**

```bash
# Search still works without the service
ctxhub search "deployment process"
ctxhub chunk list --min-tier institutional
ctxhub workspace list
```

**Paste this pre-run transcript into a shared doc and walk through it:**

```
$ ctxhub demo
  ✓ Wrote 6 sample documentation files
  ✓ Wrote .ctxhubignore
  ✓ Created workspace config
  ✓ Registered workspace "ctxhub-demo"

Indexing demo workspace...
  ✓ Indexed 42 chunk(s) from 6 files

── Demo workspace ready ──────────────────────────────────

  Workspace:  ctxhub-demo
  Path:       ~/.ctxhub/demo-workspace
  Files:      6 markdown documents
  Chunks:     12 indexed
  Promotions: 2 chunk(s) elevated to institutional tier

Next: run ctxhub dashboard to open Mission Control and see your demo workspace

$ ctxhub search "how does authentication work"
  [1] ADR-002: JWT + OIDC for authentication (institutional)
      docs/decisions/adr-002-auth.md
      "We use OpenID Connect (OIDC) for identity federation and JWT as the token format..."

  [2] System Architecture — Authentication
      docs/architecture.md
      "Authentication uses OpenID Connect with Microsoft Entra ID as the identity provider..."
```

**Screenshots to have ready** (save these to your Desktop before the meeting):
- Mission Control with the demo workspace loaded and chunks visible
- The Groups panel showing a sharing matrix
- The Events panel showing a chunk promotion event in the SSE stream
- `ctxhub auth status` output showing a valid Entra session

---

## Post-meeting

Send the VF3 CTO a follow-up with:
1. Link to `docs/deploy/SELF_HOSTED.md` for the Helm/Docker Compose deployment guide
2. Link to `docs/quickstart.md` for the enterprise quickstart (Entra ID setup walkthrough)
3. Offer to walk through the design partner charter (`docs/strategy/DESIGN_PARTNER_CHARTER.md`)
4. Ask specifically: which repos/services would they want to index first in a pilot?
