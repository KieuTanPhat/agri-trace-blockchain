# Chaincode-as-a-service image: one container per organization peer.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY dist ./dist
ENV NODE_ENV=production
USER node
CMD ["sh", "-c", "exec npx fabric-chaincode-node server --chaincode-address=${CHAINCODE_SERVER_ADDRESS} --chaincode-id=${CHAINCODE_ID}"]
