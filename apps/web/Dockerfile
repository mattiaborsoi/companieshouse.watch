FROM node:26-alpine AS base

# ── deps stage: install production deps ──────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Use npm install if no lockfile exists; npm ci if it does
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ── builder stage ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# DATABASE_URL is not needed at build time (queries run at request time)
RUN npm run build

# ── runner stage: minimal production image ────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Next standalone tracer doesn't reliably include ioredis. Force-copy the whole
# transitive set so server-side imports resolve at runtime.
# This list must match ioredis's dependencies in package-lock.json — ioredis
# 5.11 dropped lodash.defaults/lodash.isarguments and added debug (+ ms).
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/ioredis ./node_modules/ioredis
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@ioredis ./node_modules/@ioredis
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/cluster-key-slot ./node_modules/cluster-key-slot
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/debug ./node_modules/debug
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/denque ./node_modules/denque
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/ms ./node_modules/ms
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/redis-errors ./node_modules/redis-errors
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/redis-parser ./node_modules/redis-parser
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/standard-as-callback ./node_modules/standard-as-callback

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
