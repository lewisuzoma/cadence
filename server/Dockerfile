# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT, so that `shared/` is available to the build.
#   docker build -f server/Dockerfile .
#
# Stages:
#   deps      - the full dependency tree (dev included), for building
#   builder   - compiles shared + server, generates the Prisma client.
#               Also the image the one-shot `migrate` job runs from, because
#               it is the only stage that has the Prisma CLI and tsx.
#   prod-deps - production dependencies only
#   runtime   - the API: production deps + compiled output, non-root

# ---------------------------------------------------------------- deps -------
FROM node:20-alpine AS deps
WORKDIR /app
# Only the manifests, so this layer caches until a dependency actually changes.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

# ------------------------------------------------------------- builder -------
FROM node:20-alpine AS builder
WORKDIR /app
# OpenSSL is needed by the Prisma engines on Alpine.
RUN apk add --no-cache openssl
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
RUN npx prisma generate --schema server/prisma/schema.prisma \
  && npm run build -w shared \
  && npm run build -w server

# ----------------------------------------------------------- prod-deps -------
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------- runtime -------
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=prod-deps /app/node_modules ./node_modules
# The generated Prisma client is a build artefact, so it comes from builder.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# `@cadence/shared` is a workspace symlink in node_modules pointing at
# /app/shared, so the built package has to live there.
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/dist ./server/dist
# Shipped for reference and for `prisma migrate deploy` run manually.
COPY server/prisma ./server/prisma

# No secrets are baked in: every value arrives at runtime from .env.
USER node
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "dist/server.js"]
