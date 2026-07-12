# Local DX: the ctxhub Cloud stack, on a laptop

Exercise the full loop — a self-hosted ctxhub instance syncing to Cloud, browsable in Mission
Control's Cloud and Groups panels — without a real cloud account, an Entra tenant, or any
hosting decision. Useful for demos, and for developing anything that touches the Cloud/Groups
surface.

This is deliberately separate from [`docker-compose.yml`](../../docker-compose.yml) (the
production single-tenant self-hosted deployment, which needs real Entra credentials) and from
[`helm/`](../../helm/) (Kubernetes). Nothing here needs real credentials of any kind.

## What's real and what's mocked

| Piece | Status |
|---|---|
| Postgres | Real (Docker, `postgres:17-alpine`) |
| `schema.sql` | Real — applied to the Postgres container as-is |
| Cloud service (`src/cloud/serve.ts`) | Real HTTP server, real routes | 
| Cloud service's data store | **In-memory** — not wired to the Postgres container yet. Restarting the `cloud-service` container loses all orgs/chunks/runs/notes. `src/cloud/db.ts` exists and is tested (`src/cloud/db.integration.test.ts`) but isn't plugged into `service.ts` yet — that's the natural next step if this needs to survive restarts. |
| Self-hosted `ctxhub` instance | Real — same binary, same `ctxhub demo`/`ctxhub captain`/`ctxhub cloud sync` commands you'd use against a production deployment |
| Entra ID / SSO | Not involved at all — the Cloud service here uses a single bootstrap admin key (`CLOUD_ADMIN_KEY`), not OIDC |

## Quickstart

```bash
docker compose -f docker-compose.cloud.yml up -d --build
scripts/demo-cloud.sh
```

The script registers a demo org, scaffolds a local `ctxhub demo` workspace, configures Cloud
sync, runs a Captain task, syncs chunks + Captain run history to Cloud, and verifies the data
actually landed with a direct `GET /sync/history` call — not just "the commands didn't error."

Tear down with:

```bash
docker compose -f docker-compose.cloud.yml down
```

## Doing this by hand

```bash
# 1. Bring up Postgres + the Cloud service (admin key set in docker-compose.cloud.yml)
docker compose -f docker-compose.cloud.yml up -d --build

# 2. Register an org (needs the admin key)
curl -X POST http://localhost:3001/orgs \
  -H "Authorization: Bearer local-dev-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Org","slug":"my-org","orgApiKey":"my-org-key"}'

# 3. Point a self-hosted workspace at it
ctxhub cloud configure --endpoint http://localhost:3001 --api-key my-org-key

# 4. Sync
ctxhub cloud sync

# 5. See it landed
ctxhub cloud status
curl http://localhost:3001/sync/history -H "Authorization: Bearer my-org-key"
```

## Running the Cloud service outside Docker

```bash
npm run build
CLOUD_ADMIN_KEY=local-dev-admin-key PORT=3001 node dist/cloud/serve.js
```

`CLOUD_ADMIN_KEY` is required — without it there's no way to register an org via `POST /orgs`
on a freshly started service (this used to only work in tests, which poke the store directly;
see `src/cloud/serve.ts`'s doc comment).

## Postgres, standalone

Useful for iterating on `schema.sql` or `src/cloud/db.ts` without the Cloud service:

```bash
docker run -d --name ctxhub-dev-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=ctxhub \
  -p 15432:5432 postgres:17-alpine

DATABASE_URL=postgres://postgres:dev@localhost:15432/ctxhub \
  node --import tsx --test src/cloud/db.integration.test.ts
```

## Why not MiniStack / a full AWS emulator?

[`docs/cloud_architecture.md`](../cloud_architecture.md) specifies **Railway** (managed
Postgres) for the MVP deploy target, with AWS/GCP explicitly deferred to a later "scale" tier.
Plain Docker Postgres is the closer match for what's actually planned and is faster to start.
An AWS API emulator (MiniStack, LocalStack) becomes the right tool specifically for the
Enterprise **air-gapped deployment** item, where self-hosted customers may run on AWS-shaped
infrastructure and the Docker Compose / Helm chart need validating against something
AWS-API-compatible — not for this MVP-shaped local loop.
