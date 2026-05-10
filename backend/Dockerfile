# syntax=docker/dockerfile:1

FROM oven/bun:1
WORKDIR /usr/src/app

COPY backend ./backend
COPY src ./src

WORKDIR /usr/src/app/backend
RUN bun install --frozen-lockfile

EXPOSE 8613

CMD ["bun", "src/server.ts"]
