FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci --workspace=@trueda-tribe-id/api --workspace=@trueda-tribe-id/contracts --workspace=@trueda-tribe-id/web --include-workspace-root
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/web apps/web
COPY apps/mobile/src apps/mobile/src
COPY packages/contracts packages/contracts
RUN npm run build -w @trueda-tribe-id/contracts && npm run build -w @trueda-tribe-id/api && npm run build -w @trueda-tribe-id/web
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
# A clean production tree avoids extraneous optional peers retained by pruning
# the combined build tree. Mobile tooling and web build dependencies stay out.
RUN npm ci --omit=dev --workspace=@trueda-tribe-id/api --workspace=@trueda-tribe-id/contracts --include-workspace-root
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --chown=node:node packages/database/package.json packages/database/migrate.mjs packages/database/cleanup.mjs ./packages/database/
COPY --chown=node:node packages/database/migrations ./packages/database/migrations
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 3001
CMD ["node","apps/api/dist/server.js"]
