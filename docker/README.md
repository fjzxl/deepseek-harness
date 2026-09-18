# dsh 一体化 Docker 镜像

内置两个插件:[dsh-ppt-studio](../plugins/dsh-ppt-studio/README.md)(PPT 生成工作室,注册进 `web` 与 `headless` profile,构建期校验组合树)与 [dsh-passwords](../plugins/dsh-passwords/README.md)(认证网关,登录页/多租户/审计,GPL-3.0)。对应 `plugins/dsh-ppt-studio/README.md` "部署(内网 / 单一入口)"备忘的落地实现。

## 架构 / architecture

dsh web(127.0.0.1:3080)与 deck 预览服务(127.0.0.1:3170)按产品安全设计只绑容器内回环地址。dsh-passwords 认证网关是唯一对外端口(8080,登录认证后反代),容器内 nginx 只听回环(8090)做路径分流。无前置网关:直接在机器 docker 上把宿主端口(如 20001)映射到容器 8080,整机对外也只暴露这一个端口。0.1.5-rc.2 的浏览器会话认证(启动时打印的一次性 token URL)由密码门自动换证注入,远程访问不再需要该 URL,也不需要 `DSH_TRUSTED_HOSTS`。

```
浏览器 ──→ 宿主:20001 ──→ 容器 dsh-passwords 网关:8080(登录认证)
                               └─ 反代 → nginx 127.0.0.1:8090
                                           ├─ /            → 127.0.0.1:3080  dsh web UI
                                           └─ /ppt-studio/ → 127.0.0.1:3170  deck 预览
```

## 构建 / build

构建上下文必须是仓库根(`COPY . .` 需要整个源码树),在仓库根执行:

```sh
# 默认值全部是公网地址,无需任何 --build-arg 即可构建
docker build -f docker/Dockerfile -t dsh-ppt-studio:latest .
```

构建约需 10–20 分钟(pnpm 全量构建 + web 前端 + 插件 npm 构建),镜像约 3–5 GB,需要网络(node-gyp 头文件与依赖下载)。

构建地址的默认值固化在 `docker/Dockerfile` 的 ARG 声明里,仅更换地址/升级版本时才用 `--build-arg` 覆盖:

| build-arg | 默认值 | 说明 |
|---|---|---|
| `NODE_IMAGE` | `node:22.19` | 基础镜像(Docker Hub),与内网部署同 tag(引擎要求 `^22.19 \|\| >=24`) |
| `NPM_REGISTRY` | `https://registry.npmjs.org` | npm 源(pnpm/npm 共用) |
| `PNPM_VERSION` | `11.7.0` | 与根 package.json 的 `packageManager` 一致 |
| `APT_MIRROR` | 空(用镜像自带 deb.debian.org) | Debian 源根(其下需含 debian 与 debian-security) |
| `NODE_DIST_URL` | 空(nodejs.org) | node-gyp 头文件镜像,仅构建机访问不到 nodejs.org 时设置 |

```sh
# 内网/离线环境构建示例(覆盖为镜像源地址):
docker build -f docker/Dockerfile \
  --build-arg NODE_IMAGE=<内网镜像仓库>/node:22.19 \
  --build-arg NPM_REGISTRY=<内网npm源> \
  --build-arg APT_MIRROR=<内网debian源根> \
  -t <镜像仓库地址>/<项目名>:<tag> .
```

## 运行 / run

web 常驻栈(默认),宿主 20001 映射到容器网关 8080;`DEEPSEEK_API_KEY` 从宿主环境透传(也可写成 `-e DEEPSEEK_API_KEY=sk-...` 显式注入),镜像名与上面构建命令的 tag 一致:

```sh
docker run -d --name dsh-ppt-studio \
  -p 20001:8080 \
  -e DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
  -e PPT_STUDIO_PREVIEW_BASE_URL="http://127.0.0.1:20001/ppt-studio" \
  -v dsh-ppt-studio-home:/root/.dsh \
  -v "$PWD/docker-decks:/data/decks" \
  -v dsh-passwords-state:/data/dsh-passwords \
  dsh-ppt-studio:latest web
```

局域网内其他机器访问时,把 `PPT_STUDIO_PREVIEW_BASE_URL` 换成 `http://<机器地址>:20001/ppt-studio`。停止:`docker rm -f dsh-ppt-studio`。

### 首次配置(dsh-passwords)

首次启动容器自动生成一次性 SETUP_KEY,浏览器打开 `http://127.0.0.1:20001` 会进入配置页,输入它创建主用户;之后所有访问(含 `/ppt-studio/` 预览)先过登录页:

```sh
docker exec dsh-ppt-studio cat /data/dsh-passwords/setup-key.txt
```

配置成功后 setup-key.txt 自动删除。账号管理(子用户/权限/配额)在登录后的设置页「dsh-passwords · 密码门」卡片。本机与局域网访问都不需要再配 `DSH_TRUSTED_HOSTS`;预览链接前缀已在上面的运行命令里配好。

注意:无前置网关时 20001 是明文 HTTP,仅限可信网络;需要 HTTPS 可给密码门配 `MCP_GATEWAY_TLS_CERT`/`MCP_GATEWAY_TLS_KEY` 或启用自动 Let's Encrypt(需 80/443 直达容器,见 plugins/dsh-passwords/README.md)。健康排查:`docker exec dsh-ppt-studio curl -s http://127.0.0.1:8080/gateway/healthz`。

一次性任务(headless,不需要任何端口,不启动网关):

```sh
docker run --rm \
  -e DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
  -v dsh-ppt-studio-home:/root/.dsh \
  -v "$PWD/docker-decks:/data/decks" \
  dsh-ppt-studio:latest headless "做一份介绍深度学习的PPT,输出到 /data/decks"
```

只跑预览服务或透传 dsh CLI:

```sh
docker run --rm dsh-ppt-studio:latest preview
docker run --rm dsh-ppt-studio:latest --profile web --dump-config | grep dsh-ppt-studio   # 验证插件层
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 无 | 模型调用凭据,`docker run -e` 注入 |
| `DEEPSEEK_BASE_URL` | 公网 API | 内网模型网关地址;`.env` 是引导保留名,只能用真实环境变量 |
| `DSH_TRUSTED_HOSTS` | 空 | **密码门接管后不再需要**(网关注入换证 Cookie 并改写 Host 为回环源,token 门与信任栅栏都自动通过);仅在不带密码门的形态下使用 |
| `PPT_STUDIO_OUTPUT_DIR` | `/data/decks` | deck 工作区根目录,挂卷持久化 |
| `PPT_STUDIO_PREVIEW_PORT` | `3170` | 预览服务端口(容器内) |
| `PPT_STUDIO_PREVIEW_BASE_URL` | `http://127.0.0.1:3170` | 生成预览链接的前缀;对外访问时设为 `http://<机器地址>:20001/ppt-studio`;预览链接现在要求登录 |
| `MCP_GATEWAY_*` / `SETUP_KEY` | 见插件 README | dsh-passwords 网关配置,首启固化进 `/data/dsh-passwords/.env`,一般无需在 run 时设置 |

## 卷

- `dsh-ppt-studio-home:/root/.dsh` — harness home(profiles 与会话数据持久化;换新卷时入口脚本会自动重新注册插件)
- `./docker-decks:/data/decks` — deck 工作区,宿主可直接取产物(含 PPTX)
- `dsh-passwords-state:/data/dsh-passwords` — 密码门状态(.env/SQLite 账号库/证书);删除则账号与 SETUP_KEY 全部重置

## 插件说明

dsh-ppt-studio 注册走 `dsh plugin --profile <name> add /opt/dsh/plugins/dsh-ppt-studio` 的标准路径(`pnpm link` 语义),注册后 `dsh.profile.bundles` 含 `dsh-ppt-studio`,会话内可见 19 个 `ppt_*` 工具与 dsh-ppt-studio 技能。dsh-passwords 走自带的 `scripts/register-plugin.mjs` 精确注册(避免 `plugin add` 的 bundles 全量 reconcile 冲突),随 dsh web 自启动网关。插件的完整接入说明见 [plugins/dsh-ppt-studio/README.md](../plugins/dsh-ppt-studio/README.md) 与 [plugins/dsh-passwords/README.md](../plugins/dsh-passwords/README.md);`plugins/` 目录由外部源码仓 tar 同步,不要在这里直接改它的文档。
