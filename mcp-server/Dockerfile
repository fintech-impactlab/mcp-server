FROM node:22-alpine AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
RUN pnpm run build

FROM node:22-alpine AS deps
WORKDIR /app
ENV NODE_ENV=production
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Patch OS packages (musl, zlib, openssl, ...) and strip dev tools that
# are not needed at runtime (npm, yarn, corepack). Trivy scans the whole
# filesystem; npm bundles vulnerable transitives (picomatch, etc.) that
# we don't use to run `node dist/index.js`.
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /opt/yarn-v* \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg \
           /usr/local/bin/corepack

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
