---
name: ctxhub-diagram
description: Create or update a team-visible Mermaid architecture diagram for system relationships, flows, ownership boundaries, integrations, or runtime topology.
argument-hint: What architecture, flow, or relationship should be diagrammed?
---

Treat the user's invocation text as the architecture or flow to capture. If the owning repo is unclear, run `ctxhub repo list` or search for the main component first. Prefer the repo that owns the relationship or runtime boundary being diagrammed, not one that merely consumes it.

## What to do

1. Gather evidence first with `ctxhub-context`, `ctxhub-search`, or the ctxhub MCP tools. Do not invent components. Check existing architecture docs/diagrams first so you update or reuse them instead of duplicating the same flow.
2. Create the scaffold with: `ctxhub diagram add <repo> "<short-title>" --agent <your-name>`.
3. Edit the generated `.mmd` file under `<repo>/docs/architecture/`.
4. Prefer simple Mermaid: `flowchart LR` for component relationships and ownership boundaries, or `sequenceDiagram` for request/event flows.
5. Use stable service, repo, or component names. Mark uncertainty instead of presenting guesses as facts.
6. Leave the diagram as a normal repo change for review; ctxhub indexes `.mmd`, `.mermaid`, and Mermaid fenced blocks after indexing.

You do not need to teach Mermaid exhaustively. Keep the diagram factual, small enough to review, and useful as indexed architecture evidence.
