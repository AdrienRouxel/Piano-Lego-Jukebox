FROM node:22-bookworm-slim

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app

COPY --chown=node:node package.json server.mjs README.md ./
COPY --chown=node:node scripts/ ./scripts/
COPY --chown=node:node docs/ ./docs/
COPY --chown=node:node web/ ./web/
COPY --chown=node:node tracks/ ./tracks/

# Le serveur initialise la bibliothèque et conserve sa session sur disque.
RUN chown node:node /app
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
