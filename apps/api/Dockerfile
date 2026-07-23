# Copies pre-built artifacts only — no npm install or build happens inside
# Docker, so this works on a client host with no internet access. Run
# `npm run package` (or at minimum `npm ci && npm run build:api`) from the
# repo root before building this image. Build from the repo root:
#   docker build -f apps/api/Dockerfile ..
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY node_modules ./node_modules
# Workspace packages the API imports at runtime — node_modules/@assetcore/*
# are relative symlinks into packages/, so the targets must be present too.
COPY packages ./packages
COPY apps/api/package.json apps/api/package.json
COPY apps/api/dist apps/api/dist
# scripts/ + db/migrations are also baked in so `docker compose run --rm api
# node /repo/scripts/migrate.mjs` (etc.) works off this same image — no
# separate "tools" image needed just to run the one-off setup scripts.
COPY scripts ./scripts
COPY db ./db
WORKDIR /repo/apps/api

EXPOSE 8787
CMD ["node", "dist/index.js"]
