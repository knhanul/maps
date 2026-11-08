FROM node:24-alpine
ARG PMTILES_VERSION=1.31.2
RUN apk add --no-cache tzdata && wget -qO- https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz | tar -xz -C /usr/local/bin pmtiles && pmtiles version
ENV TZ=Asia/Seoul NODE_ENV=production OUT_DIR=/out PMTILES=/usr/local/bin/pmtiles
WORKDIR /app
COPY worker.mjs ./
USER 999:982
CMD ["node", "--max-old-space-size=48", "worker.mjs"]
