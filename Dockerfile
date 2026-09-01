FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV MCP_TRANSPORT=http
EXPOSE 3123

CMD ["node", "dist/server.js"]
