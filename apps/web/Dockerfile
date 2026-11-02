# syntax=docker/dockerfile:1.7
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS dependencies
WORKDIR /app

COPY package.json package-lock.json .npmrc .node-version ./
COPY apps/mobile/compat/minimatch-legacy apps/mobile/compat/minimatch-legacy
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY blockchain/chaincode/package.json blockchain/chaincode/package.json
COPY blockchain/gateway/package.json blockchain/gateway/package.json
RUN npm install --global npm@12.1.0 && npm ci

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS mobile
WORKDIR /app/apps/mobile
COPY apps/mobile/package.json apps/mobile/package-lock.json ./
COPY apps/mobile/compat ./compat
RUN npm install --global npm@12.1.0 && npm ci --workspaces=false --no-audit --no-fund
COPY apps/mobile ./
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api
ARG NEXT_PUBLIC_TRACE_BASE_URL=http://localhost:3000/trace
ENV EXPO_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV EXPO_PUBLIC_TRACE_ORIGIN=$NEXT_PUBLIC_TRACE_BASE_URL
ENV EXPO_PUBLIC_APP_VARIANT=consumer
RUN node node_modules/expo/bin/cli export --platform web

FROM dependencies AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api
ARG NEXT_PUBLIC_API_SAME_ORIGIN=false
ARG NEXT_PUBLIC_TRACE_BASE_URL=http://localhost:3000/trace
ARG NEXT_PUBLIC_MOCK_API=false
ARG NEXT_PUBLIC_USE_MOCK_API=false
ARG NEXT_PUBLIC_API_MODE=api
ARG NEXT_PUBLIC_BUSINESS_ORIGIN=
ARG NEXT_PUBLIC_CUSTOMER_ORIGIN=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_SAME_ORIGIN=$NEXT_PUBLIC_API_SAME_ORIGIN
ENV NEXT_PUBLIC_TRACE_BASE_URL=$NEXT_PUBLIC_TRACE_BASE_URL
ENV NEXT_PUBLIC_MOCK_API=$NEXT_PUBLIC_MOCK_API
ENV NEXT_PUBLIC_USE_MOCK_API=$NEXT_PUBLIC_USE_MOCK_API
ENV NEXT_PUBLIC_API_MODE=$NEXT_PUBLIC_API_MODE
ENV NEXT_PUBLIC_BUSINESS_ORIGIN=$NEXT_PUBLIC_BUSINESS_ORIGIN
ENV NEXT_PUBLIC_CUSTOMER_ORIGIN=$NEXT_PUBLIC_CUSTOMER_ORIGIN
COPY apps/web apps/web
COPY --from=mobile /app/apps/mobile/dist apps/web/public/mobile
RUN npm run build --workspace apps/web

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

RUN npm install --global npm@12.1.0 && npm cache clean --force

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/public apps/web/public
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
