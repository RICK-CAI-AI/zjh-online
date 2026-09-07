# 炸金花联机 · 云端部署用（Koyeb / 任意支持 Docker 的平台）
FROM node:22-alpine

WORKDIR /app

# 先装依赖（利用缓存层）
COPY package*.json ./
RUN npm ci --omit=dev

# 再拷源码
COPY . .

# Koyeb 会把外部 HTTPS 流量转发到容器 8080
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
