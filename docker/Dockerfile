# dsh + dsh-ppt-studio 插件一体化镜像 / dsh with the dsh-ppt-studio plugin baked in.
#
# 仓库根为构建上下文: docker build -f docker/Dockerfile .
# Build from the repo root: docker build -f docker/Dockerfile .
#
# 容器内布局: /opt/dsh 为 harness 检出(含构建产物), /root/.dsh 为 harness home
# (web/headless profile 均已注册 dsh-ppt-studio), /data/decks 为 deck 工作区。
# Layout: /opt/dsh harness checkout (built), /root/.dsh harness home
# (dsh-ppt-studio registered into the web and headless profiles), /data/decks deck workspace.
FROM node:24-bookworm

# node-pty(node-gyp)与 flock 原生插件需要编译工具链;nginx 是唯一对外入口
# (dsh web 与预览服务按产品安全设计只绑 127.0.0.1,拒绝 0.0.0.0)。
# Toolchain for node-pty (node-gyp) and the flock native addon; nginx is the
# single external listener (dsh web and the preview server bind 127.0.0.1 by design).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ nginx \
  && rm -rf /var/lib/apt/lists/*

# 根 package.json 的 packageManager 版本;`dsh plugin` 内部转发 pnpm,必须存在。
# Matches the root package.json packageManager; `dsh plugin` forwards to pnpm.
RUN npm install -g pnpm@11.7.0

WORKDIR /opt/dsh
COPY . .

RUN pnpm install --frozen-lockfile
# 全量构建:原生 flock 插件 + lib/(tsc+tsdown)+ web 前端静态产物。
# Full build: flock addon, lib/ (tsc + tsdown), web frontend static assets.
RUN pnpm run build

# dsh-ppt-studio 在 pnpm workspace 之外,按 plugins/README.md 用 npm 构建产物。
# dsh-ppt-studio lives outside the pnpm workspace; build it with npm per plugins/README.md.
RUN cd plugins/dsh-ppt-studio && npm ci && npm run build

# 把插件注册进 web 与 headless 两个 profile(初始化 profile → pnpm add → 自动追加
# dsh.profile.bundles),随后 dump 组合树验证插件层存在,缺了让构建失败。
# Register the plugin into the web and headless profiles (init → pnpm add → the
# dsh.profile.bundles layer list), then verify the composed tree names it.
RUN node apps/cli/lib/bin.js plugin --profile web add /opt/dsh/plugins/dsh-ppt-studio \
  && node apps/cli/lib/bin.js plugin --profile headless add /opt/dsh/plugins/dsh-ppt-studio \
  && node apps/cli/lib/bin.js --profile web --dump-config | grep -q dsh-ppt-studio \
  && node apps/cli/lib/bin.js --profile headless --dump-config | grep -q dsh-ppt-studio

# 预览链接默认指向容器内回环;经网关访问时由 run.sh 覆盖为网关地址。
# Preview links default to the in-container loopback; override for gateway access.
ENV DSH_HOME=/root/.dsh \
    PPT_STUDIO_OUTPUT_DIR=/data/decks \
    PPT_STUDIO_PREVIEW_PORT=3170 \
    PPT_STUDIO_PREVIEW_BASE_URL=http://127.0.0.1:3170 \
    PPT_STUDIO_PREVIEW_AUTO_OPEN=0 \
    NGINX_PROXY_PORT=8080

RUN mkdir -p /data/decks
VOLUME /data/decks
EXPOSE 8080

ENTRYPOINT ["/opt/dsh/docker/entrypoint.sh"]
# 默认 web 常驻栈(nginx + 预览服务 + dsh web);`docker run 镜像 headless "任务"`
# 走一次性任务,其他参数原样透传给 dsh CLI。
# Default is the web stack (nginx + preview server + dsh web); `headless "task"`
# runs a one-shot task; anything else passes through to the dsh CLI verbatim.
CMD ["web"]
