#!/usr/bin/env sh
# 在新服务器（Ubuntu / Debian）上首次部署云上寺。用法：
#   1. 把仓库放到服务器（git clone 或上传），进入目录
#   2. cp .env.example .env，填 ADMIN_TOKEN 和 DOMAIN
#   3. sh deploy/server-setup.sh
# 之后更新代码只需重新执行第 3 步。
set -eu
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "安装 Docker …"
  curl -fsSL https://get.docker.com | sh
fi

[ -f .env ] || { echo "缺少 .env：先 cp .env.example .env 并填写"; exit 1; }
grep -q '^DOMAIN=.\+' .env || { echo ".env 里没有 DOMAIN"; exit 1; }

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
echo "完成。访问 https://$(grep '^DOMAIN=' .env | cut -d= -f2)"
