# syntax=docker/dockerfile:1.7
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS dependencies
WORKDIR /app

COPY package.json package-lock.json .npmrc .node-version ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY blockchain/chaincode/package.json blockchain/chaincode/package.json
COPY blockchain/gateway/package.json blockchain/gateway/package.json
RUN npm install --global npm@12.1.0 && npm ci

FROM dependencies AS build
COPY apps/api apps/api
COPY blockchain/gateway blockchain/gateway
RUN npm run build --workspace blockchain/gateway \
    && npm run prisma:generate --workspace apps/api \
    && npm run build --workspace apps/api

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json .npmrc .node-version ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY blockchain/chaincode/package.json blockchain/chaincode/package.json
COPY blockchain/gateway/package.json blockchain/gateway/package.json
RUN npm install --global npm@12.1.0 \
    && npm ci --omit=dev --workspace apps/api --workspace blockchain/gateway \
    && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --from=build /app/apps/api/scripts apps/api/scripts
COPY --from=build /app/apps/api/assets apps/api/assets
COPY --from=build /app/blockchain/gateway/dist blockchain/gateway/dist

USER node
EXPOSE 8080
EXPOSE 8081
CMD ["node", "apps/api/dist/main.js"]
