# Copies pre-built SPA bundles only — no npm install or build happens inside
# Docker, so this works on a client host with no internet access. Per-client
# branding (VITE_INSTANCE_*) is baked in when `npm run build:app` /
# `build:admin` runs on the machine producing the release (see
# `scripts/package.mjs`) — rebuilding is required to rebrand, not just a
# container restart. Build from the repo root:
#   docker build -f deploy/nginx/Dockerfile ..
FROM nginx:1.27-alpine
COPY deploy/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/app/dist /usr/share/nginx/html
COPY apps/admin/dist /usr/share/nginx/html/admin

EXPOSE 80
