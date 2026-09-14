#!/usr/bin/env bash
# 运行 dsh + dsh-ppt-studio 镜像 / run the dsh + dsh-ppt-studio image.
#
# 用法 / usage:
#   ./docker/run.sh                      # web 常驻栈(默认,网关部署形态)
#   ./docker/run.sh --headless "任务"    # 一次性任务,即跑即走
#   ./docker/run.sh --preview            # 只跑 deck 静态预览服务
#   ./docker/run.sh -- <dsh 参数...>     # 原样透传给镜像入口
#
# 环境变量 / environment:
#   IMAGE_NAME/IMAGE_TAG            镜像名与标签(默认 dsh-ppt-studio:latest)
#   DEEPSEEK_API_KEY                必需;模型调用凭据(透传进容器)
#   DEEPSEEK_BASE_URL               可选;内网网关地址(只能用环境变量,.env 不接受该名字)
#   DSH_PORT                        宿主发布端口(默认 3080;网关转发到这个端口)
#   DSH_TRUSTED_HOSTS               空格分隔的网关 authority,如 "gw.example.com:31688",
#                                   通过网关访问 web UI 时必须提供
#   PPT_STUDIO_PREVIEW_BASE_URL     预览链接前缀;经网关访问时设为
#                                   "https://<网关>:<端口>/ppt-studio"
#   DECKS_DIR                       宿主 deck 目录(默认 ./docker-decks → /data/decks)
#   CONTAINER_NAME                  容器名(默认 dsh-ppt-studio)
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE="${IMAGE_NAME:-dsh-ppt-studio}:${IMAGE_TAG:-latest}"

# 宿主已设置的变量才加 -e,未设置的交给镜像内默认值。
# Only forward variables the host actually set; image defaults cover the rest.
base_args() {
  local var
  for var in DEEPSEEK_API_KEY DEEPSEEK_BASE_URL DSH_TRUSTED_HOSTS \
    PPT_STUDIO_OUTPUT_DIR PPT_STUDIO_PREVIEW_PORT PPT_STUDIO_PREVIEW_BASE_URL; do
    if [ -n "${!var:-}" ]; then
      printf '%s\n' -e
      printf '%s\n' "$var"
    fi
  done
}

volume_args() {
  printf '%s\n' -v
  printf '%s\n' "${CONTAINER_NAME:-dsh-ppt-studio}-home:/root/.dsh"
  mkdir -p "${DECKS_DIR:-$PWD/docker-decks}"
  printf '%s\n' -v
  printf '%s\n' "${DECKS_DIR:-$PWD/docker-decks}:/data/decks"
}

mapfile_args() {
  mapfile -t "$1" < <("$2")
}

case "${1:-web}" in
  web | --web)
    mapfile_args env_args base_args
    mapfile_args vol_args volume_args
    docker run -d --name "${CONTAINER_NAME:-dsh-ppt-studio}" \
      -p "${DSH_PORT:-3080}:8080" \
      "${env_args[@]}" "${vol_args[@]}" \
      "$IMAGE" web
    echo
    echo "容器已启动。验证 / verify:"
    echo "  docker logs -f ${CONTAINER_NAME:-dsh-ppt-studio}"
    echo "  curl http://127.0.0.1:${DSH_PORT:-3080}/            # dsh web UI"
    echo "  curl http://127.0.0.1:${DSH_PORT:-3080}/ppt-studio/ # deck 预览"
    echo
    echo "网关侧把一个端口转发到本机 ${DSH_PORT:-3080} 即可;"
    echo "浏览器经网关访问时设置 DSH_TRUSTED_HOSTS(网关 authority)并重启容器,"
    echo "并把 PPT_STUDIO_PREVIEW_BASE_URL 设为 https://<网关>:<端口>/ppt-studio。"
    echo
    echo "停止 / stop: docker rm -f ${CONTAINER_NAME:-dsh-ppt-studio}"
    ;;
  --headless)
    shift
    [ "$#" -gt 0 ] || {
      echo "用法: ./docker/run.sh --headless \"任务文本\"" >&2
      exit 64
    }
    mapfile_args env_args base_args
    mapfile_args vol_args volume_args
    exec docker run --rm \
      "${env_args[@]}" "${vol_args[@]}" \
      "$IMAGE" headless "$@"
    ;;
  --preview)
    shift
    mapfile_args env_args base_args
    mapfile_args vol_args volume_args
    exec docker run --rm \
      "${env_args[@]}" "${vol_args[@]}" \
      "$IMAGE" preview "$@"
    ;;
  --)
    shift
    mapfile_args env_args base_args
    mapfile_args vol_args volume_args
    exec docker run --rm "${env_args[@]}" "${vol_args[@]}" "$IMAGE" "$@"
    ;;
  -h | --help | help)
    sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    echo "未知参数: $1(见 ./docker/run.sh help)" >&2
    exit 64
    ;;
esac
