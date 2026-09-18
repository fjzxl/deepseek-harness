# dsh + dsh-ppt-studio 插件一体化镜像 / dsh with the dsh-ppt-studio plugin baked in.
#
# 仓库根为构建上下文: docker build -f docker/Dockerfile .
# Build from the repo root: docker build -f docker/Dockerfile .
#
# 构建参数(全部有默认值,仅更换地址/升级版本时才需用 --build-arg 覆盖,
# 各参数含义见下方 ARG 声明处注释):
#
#   docker build -f docker/Dockerfile \
#     --build-arg NODE_IMAGE=<node镜像> \
#     --build-arg NPM_REGISTRY=<npm源> \
#     --build-arg APT_MIRROR=<debian源根> \
#     -t <镜像仓库地址>/<项目名>:<tag> .
#
# 注意:构建上下文必须是仓库根(COPY . . 需要整个源码树);若把上下文配成
# ./docker,构建上下文只有 docker/ 目录,会在 pnpm install 阶段缺文件失败。
# 老 builder(DOCKER_BUILDKIT=0)约束:指令内换行只能用续行符 \,不能写
# BuildKit 多行引号块;# syntax= 指令无效。
#
# 容器内布局: /opt/dsh 为 harness 检出(含构建产物), /root/.dsh 为 harness home
# (web/headless profile 均已注册 dsh-ppt-studio), /data/decks 为 deck 工作区。
# Layout: /opt/dsh harness checkout (built), /root/.dsh harness home
# (dsh-ppt-studio registered into the web and headless profiles), /data/decks deck workspace.
#
# NODE_IMAGE:基础镜像(构建与运行同一阶段)。tag 22.19 恰好满足仓库引擎要求
#   ^22.19 || >=24。若用 slim 变体,git/python3/make/g++ 由下方 apt 步骤补齐
# NPM_REGISTRY:npm 源地址(pnpm/npm 共用);构建机访问不到默认源时改为镜像源
# PNPM_VERSION:pnpm 版本,与根 package.json 的 packageManager 保持一致,
#   仅在升级 pnpm 时修改
# APT_MIRROR:Debian 源根地址,其下需含 debian 与 debian-security 仓库;
#   留空 = 用基础镜像自带源
# NODE_DIST_URL:node-gyp 下载 node 头文件的镜像(node-pty 与 flock 原生插件
#   编译必需)。默认留空 = 走 node-gyp 默认链路(nodejs.org);仅当该链路
#   在构建机上不可达时才设置
ARG NODE_IMAGE=node:22.19
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PNPM_VERSION=11.7.0
ARG APT_MIRROR=""
ARG NODE_DIST_URL=""
FROM ${NODE_IMAGE}

ARG NPM_REGISTRY
ARG PNPM_VERSION
ARG APT_MIRROR
ARG NODE_DIST_URL

# node-pty(node-gyp)与 flock 原生插件需要编译工具链;nginx 是唯一对外入口
# (dsh web 与预览服务按产品安全设计只绑 127.0.0.1,拒绝 0.0.0.0)。
# git 一并安装以兼容 slim 变体(slim 基础镜像不含 git):lefthook 的 postinstall
# 要 git rev-parse 探测仓库根(见下方 git stub 注释)。
# Toolchain for node-pty (node-gyp) and the flock native addon; nginx is the
# single external listener (dsh web and the preview server bind 127.0.0.1 by design).
# APT_MIRROR 非空时先把 apt 源改指镜像地址:deb822 格式的 debian.sources 与旧版
# sources.list 两种布局都兼容;第二个 sed 表达式收掉镜像地址结尾多带的 / 产生的
# //debian。代理源缓存的 Release 元数据可能长期未刷新:换源时跳过 Valid-Until
# 过期检查(InRelease 签名校验不受影响),update 失败带退避重试两次
RUN if [ -n "${APT_MIRROR}" ]; then \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i -e "s|https\?://deb\.debian\.org|${APT_MIRROR}|g" -e 's|//debian|/debian|g' \
          /etc/apt/sources.list.d/debian.sources; \
      elif [ -f /etc/apt/sources.list ]; then \
        sed -i -e "s|https\?://deb\.debian\.org|${APT_MIRROR}|g" -e 's|//debian|/debian|g' \
          /etc/apt/sources.list; \
      else \
        echo "APT_MIRROR 已设置，但未找到 apt 源配置文件" >&2; exit 1; \
      fi \
      && printf 'Acquire::Check-Valid-Until "false";\n' > /etc/apt/apt.conf.d/99-internal-mirror; \
    fi \
    && (apt-get update \
        || (sleep 10 && apt-get update) \
        || (sleep 20 && apt-get update)) \
    && apt-get install -y --no-install-recommends \
       python3 make g++ git nginx \
    && rm -rf /var/lib/apt/lists/*

# 先设 npm 源再全局安装 pnpm:不走 corepack(它不读 npm config、下载链路
# 独立且报错不含底层原因),npm 与后续 pnpm install 共用同一 registry/TLS 配置。
# NODE_DIST_URL 非空时才设 dist-url(node-gyp 头文件镜像);默认留空走 node-gyp
# 默认链路。
# 根 package.json 的 packageManager 版本;`dsh plugin` 内部转发 pnpm,必须存在。
# Matches the root package.json packageManager; `dsh plugin` forwards to pnpm.
RUN if [ -n "${NPM_REGISTRY}" ]; then \
      npm config set registry "${NPM_REGISTRY}"; \
    fi \
    && if [ -n "${NODE_DIST_URL}" ]; then \
      npm config set dist-url "${NODE_DIST_URL}"; \
    fi \
    && npm install --global "pnpm@${PNPM_VERSION}" \
    && pnpm --version

WORKDIR /opt/dsh

# 初始化最小 git 仓库:.dockerignore 已排除 .git,而 lefthook 的 postinstall
# 会 git rev-parse 探测仓库根,镜像内不做这一步会 exit status 128
# (--allow-empty 只为 git rev-parse 提供稳定根,不做实际提交内容)
RUN git init -q . \
    && git config user.email docker@local \
    && git config user.name docker \
    && git commit --allow-empty -q -m "docker stub"

COPY . .

# entrypoint 需要 exec 位:Windows 克隆/同步会丢(git 索引曾记录为 100644),
# 构建时兜底,不依赖构建上下文的文件权限
RUN chmod +x docker/entrypoint.sh

# 网络操作带退避重试,容忍(代理)源与上游同步中途的索引不一致
RUN pnpm install --frozen-lockfile \
    || (sleep 10 && pnpm install --frozen-lockfile) \
    || (sleep 30 && pnpm install --frozen-lockfile)
# 全量构建:原生 flock 插件 + lib/(tsc+tsdown)+ web 前端静态产物。
# Full build: flock addon, lib/ (tsc + tsdown), web frontend static assets.
RUN pnpm run build

# dsh-ppt-studio 在 pnpm workspace 之外,按 plugins/README.md 用 npm 构建产物。
# dsh-ppt-studio lives outside the pnpm workspace; build it with npm per plugins/README.md.
# --replace-registry-host=always:锁文件里的 tarball URL 是 registry.npmjs.org
# 绝对地址,构建机解析不了该域名时强制把主机改写到 ${NPM_REGISTRY}
# (NPM_REGISTRY 本身就是 npmjs 时改写是无操作)
RUN cd plugins/dsh-ppt-studio \
    && (npm ci --replace-registry-host=always \
        || (sleep 10 && npm ci --replace-registry-host=always)) \
    && npm run build

# 把插件注册进 web 与 headless 两个 profile(初始化 profile → pnpm add → 自动追加
# dsh.profile.bundles),随后 dump 组合树验证插件层存在,缺了让构建失败。
# Register the plugin into the web and headless profiles (init → pnpm add → the
# dsh.profile.bundles layer list), then verify the composed tree names it.
RUN node apps/cli/lib/bin.js plugin --profile web add /opt/dsh/plugins/dsh-ppt-studio \
  && node apps/cli/lib/bin.js plugin --profile headless add /opt/dsh/plugins/dsh-ppt-studio \
  && node apps/cli/lib/bin.js --profile web --dump-config | grep -q dsh-ppt-studio \
  && node apps/cli/lib/bin.js --profile headless --dump-config | grep -q dsh-ppt-studio

# dsh-passwords 认证网关插件(vendored 源码,GPL-3.0,见 plugins/README.md):构建 dist
# 供运行期注册(register-plugin.mjs)/补丁(cli.js patch)/网关自启动使用。
# --replace-registry-host=always 与 dsh-ppt-studio 同理;构建完裁掉 devDependencies
# 减小镜像。注册与补丁在运行期(entrypoint)执行:/root/.dsh 挂全新卷时 profile 为空,
# 构建期注册会被覆盖,运行期幂等流程才能自愈(与插件官方 bundled 入口同一流程)
RUN cd plugins/dsh-passwords \
    && (npm ci --replace-registry-host=always \
        || (sleep 10 && npm ci --replace-registry-host=always)) \
    && npm run build \
    && npm prune --omit=dev \
    && test -f dist/cli.js

# 预览链接默认指向容器内回环;经网关访问时用 docker run -e 覆盖为网关地址。
# Preview links default to the in-container loopback; override for gateway access.
# NGINX_PROXY_PORT:nginx 只听回环做路径分流;8080 由 dsh-passwords 认证网关对外
ENV DSH_HOME=/root/.dsh \
    PPT_STUDIO_OUTPUT_DIR=/data/decks \
    PPT_STUDIO_PREVIEW_PORT=3170 \
    PPT_STUDIO_PREVIEW_BASE_URL=http://127.0.0.1:3170 \
    PPT_STUDIO_PREVIEW_AUTO_OPEN=0 \
    NGINX_PROXY_PORT=8090 \
    DSH_PASSWORDS_ENV_FILE=/data/dsh-passwords/.env \
    MCP_DB_PATH=/data/dsh-passwords/platform.db \
    MCP_DSH_ROOT=/opt/dsh \
    MCP_DSH_RESTART_SERVICE= \
    MCP_GATEWAY_AUTO_TLS=0

RUN mkdir -p /data/decks /data/dsh-passwords
VOLUME /data/decks
EXPOSE 8080

ENTRYPOINT ["/opt/dsh/docker/entrypoint.sh"]
# 默认 web 常驻栈(nginx + 预览服务 + dsh web);`docker run 镜像 headless "任务"`
# 走一次性任务,其他参数原样透传给 dsh CLI。
# Default is the web stack (nginx + preview server + dsh web); `headless "task"`
# runs a one-shot task; anything else passes through to the dsh CLI verbatim.
CMD ["web"]
