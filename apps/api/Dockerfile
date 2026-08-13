FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @leonel-platform/api... --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @leonel-platform/shared build \
  && pnpm --filter @leonel-platform/api build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api
COPY package.json pnpm-workspace.yaml ./
WORKDIR /app/apps/api
EXPOSE 3000
# Migrate on boot. Seed only when SEED_ON_BOOT=true (local/demo); never force seed in prod.
CMD ["sh", "-c", "pnpm db:migrate && if [ \"$SEED_ON_BOOT\" = \"true\" ]; then pnpm db:seed; fi && node dist/main.js"]
