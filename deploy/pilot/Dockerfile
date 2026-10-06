FROM node:22-alpine

WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

COPY server/src ./src
COPY server/sql ./sql
COPY deploy/pilot/pilot-server.mjs deploy/pilot/check-pilot-db.mjs ./
COPY index.html admin.html booking.html /app/public/
COPY assets /app/public/assets
COPY go /app/public/go
COPY promo /app/public/promo
COPY deploy/pilot/prepare-public.mjs ./
RUN node ./prepare-public.mjs

ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
CMD ["node", "pilot-server.mjs"]
