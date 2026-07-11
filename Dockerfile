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

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production

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
