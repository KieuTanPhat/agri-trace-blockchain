# Chaincode-as-a-service image: one container per organization peer.
FROM node:22.22.3-alpine@sha256:e58326d0d441090181ac150dc2078d3e2cf6a0d42e809aebba3ef5880935ffdd
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@12.1.0 && npm ci --omit=dev --no-audit --no-fund
COPY dist ./dist
ENV NODE_ENV=production
USER node
CMD ["sh", "-c", "exec npx fabric-chaincode-node server --chaincode-address=${CHAINCODE_SERVER_ADDRESS} --chaincode-id=${CHAINCODE_ID}"]
