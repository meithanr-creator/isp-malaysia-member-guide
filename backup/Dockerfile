FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/backup
COPY backup/package*.json ./
RUN test -f package-lock.json && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node backup/job.mjs backup/manifest.mjs backup/watchdog.mjs backup/source-closure.mjs backup/restore-probe.mjs ./
COPY --chown=node:node src/ /app/source/src/
COPY --chown=node:node public/ /app/source/public/
COPY --chown=node:node functions/ /app/source/functions/
COPY --chown=node:node scanner/ /app/source/scanner/
COPY --chown=node:node infra/ /app/source/infra/
COPY --chown=node:node docs/CONTROLLED-RESTORE-PROOF.md /app/source/docs/CONTROLLED-RESTORE-PROOF.md
COPY --chown=node:node index.html tsconfig.json .firebaserc firebase.json firestore.rules firestore.indexes.json storage.rules storage-cors.json package.json package-lock.json /app/source/
COPY --chown=node:node backup/ /app/source/backup/
ARG ISP_SOURCE_VERSION
ENV ISP_SOURCE_VERSION=${ISP_SOURCE_VERSION}
RUN node -e "if(!/^[a-f0-9]{40}$/.test(process.env.ISP_SOURCE_VERSION||''))process.exit(1)"
USER node
CMD ["node","job.mjs","--run"]
