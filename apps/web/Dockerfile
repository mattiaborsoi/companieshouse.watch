FROM node:22-alpine AS base

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
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/ioredis ./node_modules/ioredis
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@ioredis ./node_modules/@ioredis
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/cluster-key-slot ./node_modules/cluster-key-slot
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/denque ./node_modules/denque
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lodash.defaults ./node_modules/lodash.defaults
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lodash.isarguments ./node_modules/lodash.isarguments
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/redis-errors ./node_modules/redis-errors
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/redis-parser ./node_modules/redis-parser
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/standard-as-callback ./node_modules/standard-as-callback

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
