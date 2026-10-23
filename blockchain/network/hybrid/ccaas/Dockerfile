# Chaincode-as-a-service image: one container per organization peer.
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@12.1.0 && npm ci --omit=dev --no-audit --no-fund
COPY dist ./dist
ENV NODE_ENV=production
USER node
CMD ["sh", "-c", "exec npx fabric-chaincode-node server --chaincode-address=${CHAINCODE_SERVER_ADDRESS} --chaincode-id=${CHAINCODE_ID}"]
