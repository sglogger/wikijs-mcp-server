# Bewusst ohne Patch-Pin: node:22-alpine folgt immer dem neuesten 22er-Release.
# Mit `docker compose build --pull` bzw. pull_policy: build wird es bei jedem
# Build frisch geholt; apk upgrade zieht zusätzlich die Alpine-Sicherheitsupdates.
FROM node:22-alpine

RUN apk upgrade --no-cache

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV MCP_TRANSPORT=http
EXPOSE 3123

CMD ["node", "dist/server.js"]
