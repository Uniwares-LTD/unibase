FROM node:24.16.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build with credential-free local defaults; environment configuration is runtime-only.
RUN npm run build

FROM node:24.16.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN groupadd --gid 1001 unitale && useradd --uid 1001 --gid unitale --no-create-home unitale
COPY --from=build --chown=1001:1001 /app/.next/standalone ./
COPY --from=build --chown=1001:1001 /app/.next/static ./.next/static
COPY --from=build --chown=1001:1001 /app/public ./public
COPY --from=build --chown=1001:1001 /app/dist/payment-worker.cjs ./payment-worker.cjs
COPY --from=build --chown=1001:1001 /app/dist/ai-worker.cjs ./ai-worker.cjs
COPY --from=build --chown=1001:1001 /app/dist/worker-healthcheck.cjs ./worker-healthcheck.cjs
USER 1001:1001
EXPOSE 3000
CMD ["node", "server.js"]
