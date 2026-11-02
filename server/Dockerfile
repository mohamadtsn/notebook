# Stage 1: Dependencies
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: Production runtime
FROM node:24-alpine
WORKDIR /app

ENV NODE_ENV=production \
    DB_FILE=/data/notebook.db \
    ATTACHMENTS_DIR=/data/attachments \
    PORT=3000

# Copy dependencies and application source
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# Create data and attachment directories with node user permissions
RUN mkdir -p /data/attachments && chown -R node:node /data
USER node

EXPOSE 3000

# Lightweight healthcheck using alpine built-in wget
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["node", "src/index.ts"]
