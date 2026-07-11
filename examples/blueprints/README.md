# Blueprints

A blueprint is a packaged set of personas, Captain task definitions, and mission templates for a specific stack or domain. Installing one gives your agents immediate, curated context for your technology — without writing config from scratch.

## Status

The Blueprint format and registry are planned for M8. This directory will hold example blueprints as the format stabilises.

Until then:
- **Propose a blueprint** via the [Blueprint Proposal issue template](../../.github/ISSUE_TEMPLATE/blueprint_proposal.md)
- **Share captain tasks today** by exporting them with `ctxhub captain export` and opening a PR to `examples/`

## What a blueprint will contain

```
my-blueprint/
  blueprint.yaml       # manifest: name, version, description, requires.runtime
  personas/            # .md persona definitions
  captain-tasks/       # .yaml captain task definitions
  missions/            # .yaml mission templates (optional)
```

## Contributing

If you have a set of Captain tasks and personas that work well for a specific stack, open a [Blueprint Proposal](../../.github/ISSUE_TEMPLATE/blueprint_proposal.md) issue. Early contributions will help shape the format before it's finalised.
