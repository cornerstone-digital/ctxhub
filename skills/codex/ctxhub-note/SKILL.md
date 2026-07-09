---
name: ctxhub-note
description: Create a team-visible, git-tracked note when you learn durable workspace knowledge that future humans or agents should review, such as a decision, workaround, integration detail, ownership fact, or operational gotcha.
argument-hint: What finding should be captured as a team note?
user-invocable: true
disable-model-invocation: false
---

## User input

```text
$ARGUMENTS
```

Treat the invocation text as the finding to capture. If the repo or title is unclear, infer the most relevant repo from the work so far or run `ctxhub repo list`.

## What to do

1. Choose the repo that owns the finding — the boundary or decision, not merely a repo that consumes it. If unsure, search first or ask a short clarifying question.
2. Create the scaffold with: `ctxhub note add <repo> "<short-title>" --agent <your-name>`.
3. Edit the created Markdown file with concise, reviewable content:
   - what was learned
   - evidence or source files
   - why it matters
   - any uncertainty or follow-up
4. Leave it as a normal repo change for review. Do not put private session notes, secrets, or speculation into team notes.

Use MemPalace or another agent memory tool for private long-term memory. Use `ctxhub note add` when the knowledge should live with the codebase and be indexed by ctxhub after it is committed.
