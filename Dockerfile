# Il bot gira come singolo processo supervisore che spawna worker figli
# (src/app/runtime.ts: spawn(process.execPath, [dist/pumpAmmSniper.js])),
# quindi serve un solo container per lo sniper e uno per il report daemon.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY scripts ./scripts

# blacklists e logs arrivano da bind mount (vedi docker-compose.yml): sono stato
# mutabile, il tracker dinamico riscrive funder-counts.json e creators.txt a runtime.
RUN mkdir -p /app/logs /app/blacklists \
    && ln -sf /app/logs/paper.log /app/paper.log

# Il supervisore esce con code 1 sul circuit breaker dell'healthcheck
# (5 resubscribe consecutivi a vuoto): restart policy di compose = ex Restart=always.
CMD ["node", "dist/pumpAmmSniper.js"]
