# 云上寺 · 单进程原型镜像（无第三方依赖）
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
COPY package.json ./
COPY server ./server
COPY client ./client
COPY admin ./admin
COPY scenes ./scenes
COPY content ./content
COPY tools ./tools
# 自托管 three.js（大陆部署必须；海外可省略，服务器会回退到 CDN）
ARG VENDOR_THREE=false
RUN if [ "$VENDOR_THREE" = "true" ]; then node tools/vendor-three.mjs; fi
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "server/index.js"]
