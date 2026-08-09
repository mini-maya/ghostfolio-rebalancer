FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine

LABEL org.opencontainers.image.source=https://github.com/mini-maya/ghostfolio-rebalancer

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=80
ENV ACCOUNTS_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY --from=builder /app/dist ./dist

VOLUME ["/data"]

EXPOSE 80

CMD ["node", "server/server.mjs"]
