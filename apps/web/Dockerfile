# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY blockchain/chaincode/package.json blockchain/chaincode/package.json
COPY blockchain/gateway/package.json blockchain/gateway/package.json
RUN npm ci

FROM dependencies AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api
ARG NEXT_PUBLIC_TRACE_BASE_URL=http://localhost:3000/trace
ARG NEXT_PUBLIC_MOCK_API=false
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_TRACE_BASE_URL=$NEXT_PUBLIC_TRACE_BASE_URL
ENV NEXT_PUBLIC_MOCK_API=$NEXT_PUBLIC_MOCK_API
COPY apps/web apps/web
RUN npm run build --workspace apps/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/public apps/web/public
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
