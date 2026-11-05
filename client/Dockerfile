# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT (the client imports `@cadence/shared`):
#   docker build -f client/Dockerfile .

# ---------------------------------------------------------------- deps -------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

# ------------------------------------------------------------- builder -------
FROM node:20-alpine AS builder
WORKDIR /app
# Same-origin by default: nginx proxies /api to the server, so the browser
# never makes a cross-origin request and cookies stay first-party.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared ./shared
COPY client ./client
RUN npm run build -w shared && npm run build -w client

# ------------------------------------------------------------- runtime -------
FROM nginx:alpine AS runtime
# Drop the stock config and use ours (SPA fallback + /api proxy + caching).
RUN rm -f /etc/nginx/conf.d/default.conf
COPY client/nginx.conf /etc/nginx/conf.d/app.conf
COPY --from=builder /app/client/dist /usr/share/nginx/html
EXPOSE 80
# nginx:alpine already drops worker processes to the `nginx` user; the master
# needs root to bind :80 inside the container.
CMD ["nginx", "-g", "daemon off;"]
