FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 DATABASE_PATH=/app/.data/stocklens.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /app/.data && chown -R node:node /app
COPY --chown=node:node server.mjs feeds.mjs ./
COPY --chown=node:node dist ./dist
COPY --chown=node:node scripts/backup.mjs ./scripts/backup.mjs
USER node
EXPOSE 4173
VOLUME ["/app/.data"]
CMD ["node", "server.mjs"]
