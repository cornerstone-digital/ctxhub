# ── Builder stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build tooling)
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Cloud service stage ──────────────────────────────────────────────────────
# Separate target (docker build --target cloud) for the ctxhub Cloud service stub
# (src/cloud/serve.ts) -- a different process from the self-hosted `ctxhub` service below.
# Used by docker-compose.cloud.yml for Local DX. Still backed by CloudStore's in-memory
# Maps, not Postgres -- see serve.ts's doc comment.
#
# Deliberately placed BEFORE the runtime stage below, not after: `docker build .` with no
# --target builds whichever stage is LAST in this file. This stage briefly came after
# runtime, which silently made it the default `docker build .` output -- the self-hosted
# product (docker-compose.yml, the Helm chart) started shipping the Cloud service stub
# instead, caught by actually deploying the chart to a real kind cluster and watching the
# pod crash-loop rather than trusting `helm lint`. Keep `runtime` last.
FROM node:22-alpine AS cloud

ENV NODE_ENV=production

WORKDIR /home/ctxhub

RUN addgroup -S ctxhub && adduser -S -u 1001 -G ctxhub ctxhub

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

USER ctxhub

EXPOSE 3001

ENTRYPOINT ["node", "dist/cloud/serve.js"]

# ── Runtime stage ─────────────────────────────────────────────────────────────
# Kept as the LAST stage so it's the default `docker build .` target -- see the comment
# on the cloud stage above for why that matters.
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
# Binds to all interfaces inside the container -- the default (127.0.0.1) only accepts
# connections from within the same network namespace, so Kubernetes probes and Service
# routing to the pod's real IP get connection-refused otherwise.
ENV CTXHUB_HOST=0.0.0.0

WORKDIR /home/ctxhub

# Create a non-root user (uid 1001) to run the service
RUN addgroup -S ctxhub && adduser -S -u 1001 -G ctxhub ctxhub

# Copy only what's needed to run
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# Copy skills directory if present
COPY --from=builder /app/skills ./skills

# Data directory — will be mounted as a volume in production
RUN mkdir -p /home/ctxhub/.ctxhub && chown -R ctxhub:ctxhub /home/ctxhub

USER ctxhub

EXPOSE 7342

ENTRYPOINT ["node", "dist/index.js", "service", "start", "--foreground"]
