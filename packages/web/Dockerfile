FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/web/package.json ./packages/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# Development target
FROM deps AS development
COPY packages/shared/ ./packages/shared/
COPY packages/web/ ./packages/web/
EXPOSE 3000
CMD ["pnpm", "--filter", "@fittrackr/web", "dev"]

# Build
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/web/ ./packages/web/
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @fittrackr/shared build
RUN pnpm --filter @fittrackr/web build

# Production
FROM base AS production
COPY --from=build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build /app/packages/web/public ./packages/web/public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "packages/web/server.js"]
