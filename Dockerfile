# syntax=docker/dockerfile:1
# CrewShift production images (task 6.1). One Dockerfile, two targets:
#   web     Next.js standalone server (port 3000)
#   worker  offer-expiry loop; also the "tools" image for `prisma migrate deploy` and the seed
#
# Node is pinned to 24.22+: older builds carry tz data from before Alberta's 2026-11-01 move
# to permanent UTC-6, and would get every store time wrong by an hour.

ARG NODE_IMAGE=node:24.22.2-alpine
ARG PNPM_VERSION=9.14.2

# ---- deps: full install (dev deps too: prisma CLI, tsx, dotenv) + generated Prisma client
FROM ${NODE_IMAGE} AS deps
ARG PNPM_VERSION
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# `prisma generate` (postinstall) only reads the schema; the URL just has to be present.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm install --frozen-lockfile

# ---- build: Next.js standalone output
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- web: minimal runtime, only the traced standalone files
FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# ---- worker: source + node_modules, run with tsx (react-server condition for server-only)
# Usage on the VM:  docker compose run --rm worker prisma migrate deploy
#                   docker compose run --rm worker prisma db seed
FROM deps AS worker
ENV NODE_ENV=production PATH=/app/node_modules/.bin:$PATH
COPY . .
# Read-only for the worker; tsx writes its cache to /tmp.
USER node
CMD ["tsx", "--conditions=react-server", "worker/index.ts"]
