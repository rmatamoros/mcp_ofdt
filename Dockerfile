# syntax=docker/dockerfile:1
# La compilacion y las dependencias corren en la plataforma del builder: el
# resultado es JavaScript puro (sin modulos nativos en produccion), asi que la
# imagen arm64 no ejecuta npm emulado con QEMU, que se colgaba en el CI.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    OFDT_DATA_DIR=/data \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["node", "dist/index.js"]
