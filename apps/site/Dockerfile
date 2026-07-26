# syntax=docker/dockerfile:1

FROM oven/bun:1
WORKDIR /usr/src/app

# Install workspace deps first for cache friendliness.
COPY package.json bun.lock ./
COPY apps/site/package.json ./apps/site/
COPY packages/core/package.json ./packages/core/
RUN bun install --frozen-lockfile

# Copy source last.
COPY apps/site ./apps/site
COPY packages/core ./packages/core

WORKDIR /usr/src/app/apps/site

ENV NODE_ENV=production
EXPOSE 8613

CMD ["bun", "server.ts"]
