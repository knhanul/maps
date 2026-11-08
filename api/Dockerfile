FROM node:24-alpine
ENV NODE_ENV=production TZ=Asia/Seoul
RUN apk add --no-cache tzdata && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "--max-old-space-size=64", "src/server.mjs"]
