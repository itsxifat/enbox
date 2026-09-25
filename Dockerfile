# syntax=docker/dockerfile:1
# Single-container Enbox: API + realtime server that also serves the built web client.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/apps/web/dist \
    MIGRATIONS_DIR=/app/apps/server/drizzle
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @enbox/server --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
VOLUME ["/data"]
EXPOSE 4000
USER node
WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
