FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# Development target
FROM deps AS development
COPY packages/shared/ ./packages/shared/
COPY packages/api/ ./packages/api/
EXPOSE 4000
CMD ["pnpm", "--filter", "@fittrackr/api", "dev"]

# Build
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/api/ ./packages/api/
RUN pnpm --filter @fittrackr/shared build
RUN pnpm --filter @fittrackr/api exec prisma generate
RUN pnpm --filter @fittrackr/api build

# Production
FROM base AS production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/api/package.json ./packages/api/
COPY --from=build /app/packages/api/prisma ./packages/api/prisma
COPY --from=build /app/packages/api/node_modules ./packages/api/node_modules
COPY packages/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
