# No build stage for the app itself: Node 24 runs the TypeScript sources directly
# (type stripping), so "build" is just installing production dependencies.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
# Attachment blobs sit beside the database on the same host bind mount, for the same
# stated reason: they are real files no docker command can wipe.
ENV NODE_ENV=production DB_FILE=/data/notebook.db ATTACHMENTS_DIR=/data/attachments PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# node:24-alpine ships a `node` user (uid 1000). The volume is chowned to it so
# SQLite can create its WAL files.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.ts"]