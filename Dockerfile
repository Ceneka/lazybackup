# Build + run on Alpine so native packages resolve musl binaries.
FROM oven/bun:1-alpine AS base

FROM base AS builder-dependencies
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Unit tests on Alpine/musl (same libc as the published image).
FROM builder-dependencies AS test
WORKDIR /app
RUN apk add --no-cache openssh-client rsync
COPY . /app
ENV DATABASE_URL=file:/tmp/lazybackup-test.db
CMD ["bun", "test"]

FROM builder-dependencies AS builder
WORKDIR /app
COPY . /app
# Writable SQLite URL for the build: bundling/collecting routes loads @/lib/db.
ENV DATABASE_URL=file:/tmp/lazybackup-build.db
RUN bun run build

# Complete trees for packages Next's file tracer under-includes (notably
# @libsql/* Bun export conditions + musl natives). Strip UI/bundled deps so
# this overlay stays ~45MB instead of a full ~560MB node_modules.
FROM base AS prod-dependencies
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production \
 && rm -rf \
      node_modules/next \
      node_modules/@next \
      node_modules/react \
      node_modules/react-dom \
      node_modules/scheduler \
      node_modules/lucide-react \
      node_modules/date-fns \
      node_modules/dayjs \
      node_modules/@img \
      node_modules/@radix-ui \
      node_modules/@tanstack \
      node_modules/@hookform \
      node_modules/react-hook-form \
      node_modules/sonner \
      node_modules/next-themes \
      node_modules/class-variance-authority \
      node_modules/clsx \
      node_modules/tailwind-merge \
      node_modules/tailwindcss-animate \
      node_modules/tailwindcss \
      node_modules/drizzle-orm \
      node_modules/@aws-sdk \
      node_modules/@smithy \
      node_modules/@aws-crypto \
      node_modules/@aws \
      node_modules/@modelcontextprotocol \
      node_modules/mcp-handler \
      node_modules/zod \
      node_modules/nanoid \
      node_modules/@types \
      node_modules/caniuse-lite \
      node_modules/styled-jsx \
      node_modules/sharp \
      node_modules/@swc \
      node_modules/postcss \
      node_modules/@floating-ui \
      node_modules/csstype \
      node_modules/typescript

FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# rsync/scp on the app host; curl for compose healthcheck
RUN apk add --no-cache openssh-client rsync curl

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Overlay completes under-traced native/SSH/DB packages without replacing
# the slim Next standalone tree.
COPY --from=prod-dependencies /app/node_modules ./node_modules

EXPOSE 3000

CMD ["bun", "server.js"]
