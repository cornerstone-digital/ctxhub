# Bazel example — validation fixture for the future Bazel `WorkspaceAdapter`

Real Bazel (`bazelisk`, which resolves to Bazel 9.1.1) via `brew install bazelisk`, with two real `BUILD.bazel` targets and a real cross-package dependency, queried with real `bazel query`. See [docs/monorepo_architecture.md](../../../docs/monorepo_architecture.md) §7: every future monorepo adapter must be proven against a repository actually generated/verified by that tool's own tooling, not a fixture that guesses at the config format.

## What's here

- `MODULE.bazel`, `WORKSPACE` — minimal real Bazel workspace root markers. `WORKSPACE` is empty (Bzlmod, via `MODULE.bazel`, is the modern default) but is still needed as a workspace boundary marker for adapter `detect()` logic. `MODULE.bazel.lock` is Bazel's own real lockfile, generated on first `bazel query`.
- `packages/core/BUILD.bazel` — a `filegroup` target, no dependencies.
- `packages/billing-service/BUILD.bazel` — a `filegroup` target whose `srcs` includes `//packages/core:core` — a real label reference, which is how Bazel expresses a cross-package dependency for any rule type.
- `graph-output.dot` — the real output of `bazel query --noenable_bzlmod 'deps(//packages/billing-service:billing-service)' --output=graph`, checked in as the snapshot a future adapter's test suite should assert against:
  ```
  "//packages/billing-service:billing-service" -> "//packages/core:core"
  ```
  That edge was produced by Bazel's own query engine over the real `BUILD.bazel` files, not written by hand. `--noenable_bzlmod` was used only to skip Bazel Central Registry network calls during this one query; it doesn't change what the dependency graph looks like.

`bazel-*` output symlinks (created by an actual `bazel build`, not by `query`) are gitignored — none were generated here since only `query` was run, but a real adapter implementation will want to avoid depending on their presence.

## What a real `BazelAdapter` should reproduce

Per `docs/monorepo_architecture.md` §4, `BazelAdapter.buildGraph()` run against this directory should produce:

```ts
{
  tool: 'bazel',
  projects: [
    { name: '//packages/core:core', kind: 'library', path: 'packages/core' },
    { name: '//packages/billing-service:billing-service', kind: 'library', path: 'packages/billing-service' },
  ],
  edges: [
    { from: '//packages/billing-service:billing-service', to: '//packages/core:core', kind: 'depends_on' },
  ],
}
```

Note for the adapter implementer: `bazel query --output=graph` produces Graphviz DOT, not JSON — `--output=jsonproto` or `--output=proto` (the machine-readable options) are the more realistic parse target for a real adapter; this fixture's `graph-output.dot` is the human-checkable reference, not necessarily the exact wire format the adapter should parse.
