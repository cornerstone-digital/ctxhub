# ctxhub Self-Hosted Deployment Guide

This guide covers deploying ctxhub in your own infrastructure using Docker Compose
(single-node / VM) or Kubernetes via Helm (cluster).

---

## Prerequisites

| Method | Requirement |
|--------|-------------|
| Docker Compose | Docker Engine 24+ and Docker Compose v2 |
| Helm | Kubernetes 1.27+, Helm 3.12+, `kubectl` configured |

Both methods require a **Microsoft Entra ID app registration** — see below.

---

## Entra ID App Registration

ctxhub uses the OIDC Authorization Code + PKCE flow to authenticate users.

1. In [Azure Portal](https://portal.azure.com) → Entra ID → App registrations → **New registration**.
2. Set a name (e.g. `ctxhub-prod`).
3. Under **Redirect URIs** → add a **Web** URI pointing at your deployed instance:
   - Docker Compose: `http://your-server:7343/callback`
   - Kubernetes (with Ingress): `https://ctxhub.example.com:7343/callback`
   - Port `7343` is the fixed callback port — it must be reachable by users' browsers.
4. Under **Certificates & secrets** → create a **client secret**. Copy the value immediately.
5. Note your **Application (client) ID** and **Directory (tenant) ID**.
6. *(Optional)* Under **Token configuration** → add a **Groups** claim (type: SecurityGroup)
   if you want to map Entra security groups to ctxhub roles.

---

## Docker Compose Quickstart

1. **Clone the repo and copy the compose file**:

   ```bash
   git clone https://github.com/martinegan/ctxhub.git
   cd ctxhub
   ```

2. **Set credentials** in `docker-compose.yml` (or export as environment variables):

   ```bash
   export CTXHUB_TENANT_ID=<your-tenant-id>
   export CTXHUB_CLIENT_ID=<your-client-id>
   export CTXHUB_CLIENT_SECRET=<your-client-secret>
   ```

   Or edit the `environment:` block in `docker-compose.yml` directly.

3. **Build and start**:

   ```bash
   docker compose up -d --build
   ```

4. **Configure ctxhub auth** (first run only):

   ```bash
   docker compose exec ctxhub node dist/index.js auth configure \
     --tenant-id "$CTXHUB_TENANT_ID" \
     --client-id "$CTXHUB_CLIENT_ID" \
     --client-secret "$CTXHUB_CLIENT_SECRET"
   ```

5. **Verify** the service is healthy:

   ```bash
   curl http://localhost:7342/health
   # {"status":"ok"}
   ```

---

## Helm Quickstart

1. **Add the chart** (or reference the local path if building from source):

   ```bash
   # From source
   cd ctxhub
   ```

2. **Create a secrets values file** (never commit this):

   ```yaml
   # values-secrets.yaml
   auth:
     tenantId: "<your-tenant-id>"
     clientId: "<your-client-id>"
     clientSecret: "<your-client-secret>"
   ```

3. **Install the chart**:

   ```bash
   helm install ctxhub ./helm/ctxhub \
     -f values-secrets.yaml \
     --set image.repository=your-registry/ctxhub \
     --set image.tag=0.1.0
   ```

4. **Check rollout**:

   ```bash
   kubectl rollout status deployment/ctxhub
   kubectl get pods -l app.kubernetes.io/name=ctxhub
   ```

5. **Verify health** via port-forward:

   ```bash
   kubectl port-forward svc/ctxhub 7342:7342
   curl http://localhost:7342/health
   ```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `CTXHUB_TENANT_ID` | Yes | Entra ID Directory (tenant) GUID |
| `CTXHUB_CLIENT_ID` | Yes | App registration Application (client) GUID |
| `CTXHUB_CLIENT_SECRET` | Yes | App registration client secret value |
| `NODE_ENV` | No | Set to `production` (default in the image) |

---

## Health Check Endpoint

```
GET /health
```

Returns `200 OK` with `{"status":"ok"}` when the service is ready. No authentication required.

Used by:
- Docker Compose `healthcheck`
- Kubernetes liveness and readiness probes
- Any external monitoring / load balancer

---

## Upgrading

### Docker Compose

```bash
docker compose pull          # pull new image (if using registry)
# or rebuild from source:
docker compose build --no-cache
docker compose up -d
```

Data in the `ctxhub-data` volume persists across upgrades.

### Helm

```bash
helm upgrade ctxhub ./helm/ctxhub \
  -f values-secrets.yaml \
  --set image.tag=<new-version>
```

Check the [CHANGELOG](../../CHANGELOG.md) for any breaking changes before upgrading.
Rolling updates are supported: Kubernetes will drain the old pod before starting the new one.
Because ctxhub stores state in the persistent volume (not in-memory), there is no data loss
during a rolling restart.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `401 missing_token` on all routes | Auth is configured but you haven't logged in. Run `ctxhub login`. |
| Login redirect fails | Ensure the redirect URI in Entra ID exactly matches `http(s)://host:7343/callback`. |
| Container exits immediately | Check `docker compose logs ctxhub` — missing auth config or port conflict. |
| PVC stuck `Pending` | Verify your cluster has a default StorageClass or set `persistence.storageClass` in values. |
