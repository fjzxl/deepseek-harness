#!/bin/sh
# dsh + dsh-ppt-studio 镜像入口。
# dsh + dsh-ppt-studio image entrypoint.
#
# 用法 / usage:
#   web            默认:预览服务(后台)+ nginx + dsh web(前台)
#                  default: background preview server + nginx + dsh web in the foreground
#   headless 任务  一次性任务,不启动任何服务
#                  one-shot task; no servers start
#   preview        只跑 deck 静态预览服务
#                  only the deck static preview server
#   其他           原样透传给 dsh CLI(如 --profile web --dump-config)
#                  anything else passes through to the dsh CLI verbatim
set -eu

DSH_ROOT=/opt/dsh
DSH_BIN="node $DSH_ROOT/apps/cli/lib/bin.js"
PLUGIN_NAME=dsh-ppt-studio
PLUGIN_DIR="$DSH_ROOT/plugins/$PLUGIN_NAME"

# 幂等确保插件在 profile 层列表里:镜像内已注册,但运行时挂载了全新的
# $DSH_HOME 卷时会得到空 profile,这里按 dsh plugin 的注册路径补齐。
# Idempotent plugin registration: baked into the image, but a fresh
# volume-mounted $DSH_HOME starts empty; re-add through the documented path.
ensure_plugin() {
  profile=$1
  if ! $DSH_BIN --profile "$profile" --dump-config 2>/dev/null | grep -q "$PLUGIN_NAME"; then
    echo "entrypoint: registering $PLUGIN_NAME into profile $profile"
    $DSH_BIN plugin --profile "$profile" add "$PLUGIN_DIR"
  fi
}

ensure_plugins() {
  for profile in web headless; do
    ensure_plugin "$profile"
  done
}

# DSH_TRUSTED_HOSTS="gw.example.com:31688 ..." → 重复的 --trusted-host 参数,
# 供经网关访问时通过 web 应用的 /api 浏览器信任栅栏。
# DSH_TRUSTED_HOSTS="gw.example.com:31688 ..." becomes repeated --trusted-host
# flags so the web app's /api browser-trust fence accepts the gateway authority.
trusted_host_args() {
  for authority in ${DSH_TRUSTED_HOSTS:-}; do
    printf '%s\n' "--trusted-host"
    printf '%s\n' "$authority"
  done
}

start_nginx() {
  rm -f /etc/nginx/sites-enabled/default
  cp "$DSH_ROOT/docker/nginx.conf" /etc/nginx/conf.d/default.conf
  sed -i "s/__NGINX_PROXY_PORT__/${NGINX_PROXY_PORT}/" /etc/nginx/conf.d/default.conf
  nginx
}

case "${1:-}" in
  web)
    shift
    ensure_plugins
    mkdir -p "$PPT_STUDIO_OUTPUT_DIR"
    node "$PLUGIN_DIR/lib/preview-server.js" &
    start_nginx
    # shellcheck disable=SC2046 # 有意的分词:trusted_host_args 逐行输出参数
    exec $DSH_BIN --profile web --no-open $(trusted_host_args) "$@"
    ;;
  headless)
    shift
    [ "$#" -gt 0 ] || {
      echo "entrypoint: headless 模式需要任务文本,例如:docker run 镜像 headless \"做一份PPT\"" >&2
      exit 64
    }
    ensure_plugins
    # shellcheck disable=SC2046 # 同上
    exec $DSH_BIN --profile headless $(trusted_host_args) "$@"
    ;;
  preview)
    shift
    mkdir -p "$PPT_STUDIO_OUTPUT_DIR"
    exec node "$PLUGIN_DIR/lib/preview-server.js" "$@"
    ;;
  *)
    exec $DSH_BIN "$@"
    ;;
esac
