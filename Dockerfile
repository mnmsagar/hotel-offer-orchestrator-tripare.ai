# syntax=docker/dockerfile:1

# Debian slim (glibc) rather than Alpine: Temporal's native core-bridge only ships glibc
# binaries, so the worker cannot run on Alpine (musl).
ARG NODE_IMAGE=node:20-bookworm-slim

# ---- deps: all dependencies, for building ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript to dist/ ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: production dependencies only ----
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: one image, runs either the API or the worker ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
# Default: API. The worker overrides this with `node dist/worker/index.js`.
CMD ["node", "dist/api/server.js"]
