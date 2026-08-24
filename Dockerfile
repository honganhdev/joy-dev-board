# One image, one process: the Bun API serves /api/* and the built web app from
# the same port. The previous deployment ran a static container next to a second
# API container; there is nothing here that needs two.

FROM oven/bun:1.3.14-slim AS deps
WORKDIR /app
# Manifests first so a source-only change does not re-resolve the dependency graph.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .
RUN bun run build

# A second install without devDependencies: vite, drizzle-kit and typescript are
# build-time only and have no business in the running image.
FROM oven/bun:1.3.14-slim AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DATABASE_PATH=/app/data/board.db

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/api/src ./apps/api/src
# `auth:hash` is run inside this image to produce AUTH_PASSWORD_HASH — the host
# has no Bun, so leaving the scripts out makes the documented setup impossible.
COPY apps/api/scripts ./apps/api/scripts
# Applied on every startup, so an empty volume comes up migrated.
COPY apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist

# The database lives here and must be a mounted volume — see deploy/compose.yaml.
# Created owned by `bun` so a fresh named volume inherits that ownership and the
# unprivileged process can actually write to it.
RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

EXPOSE 8787
CMD ["bun", "apps/api/src/index.ts"]
