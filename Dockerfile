# Use the latest Bun image as the base
FROM oven/bun:latest AS base

# Set working directory

# Install dependencies
FROM base AS builder-dependencies
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Build the app
FROM builder-dependencies AS builder
WORKDIR /app
COPY . /app
COPY --from=builder-dependencies /app/node_modules /app/node_modules
RUN bun run build

# Install dependencies for production
FROM base AS prod-dependencies
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Production image, using Bun to support migrations
FROM oven/bun:latest AS runner
WORKDIR /app
ENV NODE_ENV=production

# For standalone output, we need only specific files
# Copy the standalone server and related files
COPY --from=builder /app/.next/standalone ./
# Copy static files
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Copy migration files and database config
COPY --from=builder /app/package.json ./package.json
# copy prod dependencies
COPY --from=prod-dependencies /app/node_modules /app/node_modules

# install pm2 to run the app
RUN bun install -g pm2

# Expose the port the app will run on
EXPOSE $PORT

# Start the application using pm2 (pm2 start --interpreter ~/.bun/bin/bun server.ts)
CMD ["pm2-runtime", "start", "--interpreter", "bun", "server.js"]
