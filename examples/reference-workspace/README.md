# ctxhub reference workspace

A small, fictional 3-repo workspace (`web-app`, `notifications-service`, `billing-service`) with
real docs, one architecture diagram, and a couple of team notes — something to run ctxhub against
in five minutes without setting up a real multi-repo project first.

`ctxhub.yaml` is already checked in and configured (`memory.provider: local-json`, so no external
MemPalace install is needed just to try this). From this directory:

```bash
npm install -g ctxhub   # or: npm link, from a clone of the ctxhub repo itself
cd examples/reference-workspace
ctxhub index
ctxhub search "authentication flow"
ctxhub search "retry policy"
ctxhub pack "how does checkout work end to end?"
ctxhub graph
ctxhub report --open
```

Things worth trying:

- `ctxhub search "opaque session token"` — finds the note explaining *why*, not just what.
- `ctxhub graph` — see `web-app`/`billing-service`/`notifications-service` and their relationships,
  extracted from `web-app/docs/architecture/system.mmd`.
- `ctxhub report --open` — the full browsable HTML report: list/graph/timeline views, in-page
  wing/room filters, and evidence-backed confidence scores on every item.
- `ctxhub pr-context` / `ctxhub review "checkout flow" --as bug-hunter` — these work too, though
  they need a real git diff to have anything to say; there's no git history in this static example
  (see below).

This workspace does **not** use real git repos for its three services (`git: false` in
`ctxhub.yaml`) — they're static example content checked directly into the ctxhub repo, not nested
git checkouts. That means `ctxhub repo discover` won't find anything new here (discovery looks for
`.git` directories), and diff-based features (`pr-context`, `review`, the post-commit hook) have no
history to work from. For a real workspace, run `ctxhub onboard` in an actual directory of git
repos instead — see the main [README](../../README.md) and
[docs/quickstart.md](../../docs/quickstart.md).

One quirk from living inside the ctxhub monorepo itself: `ctxhub search`'s "stale" label reflects
whether *the git repo a search result physically sits inside* has uncommitted changes — since
these example repos have no `.git` of their own, that resolves to the outer ctxhub repo's own git
status, not a meaningful signal about these fictional services. In a real standalone workspace
(outside any parent git repo) this doesn't come up.
