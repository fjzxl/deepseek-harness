# dsh + dsh-ppt-studio Docker 镜像

带 [dsh-ppt-studio](../plugins/dsh-ppt-studio/README.md) 插件的 dsh 一体化镜像:镜像构建时把插件注册进 `web` 与 `headless` 两个 profile,并对组合树做构建期校验。对应 `plugins/dsh-ppt-studio/README.md` "部署(内网 / 单一入口)"备忘的落地实现。

## 架构 / architecture

dsh web(127.0.0.1:3080)与 deck 预览服务(127.0.0.1:3170)按产品安全设计只绑容器内回环地址,镜像内 nginx 是唯一对外端口(8080),适配"网关转发一个端口到 docker 机器"的部署。

```
网关(TLS/认证) ──→ docker机器:${DSH_PORT:-3080} ──→ 容器 nginx:8080
                                                      ├─ /            → 127.0.0.1:3080  dsh web UI
                                                      └─ /ppt-studio/ → 127.0.0.1:3170  deck 预览
```

## 构建 / build

```sh
./docker/build.sh
# 自定义名称:IMAGE_NAME=my-registry/dsh-ppt-studio IMAGE_TAG=v1 ./docker/build.sh
```

构建约需 10–20 分钟(pnpm 全量构建 + web 前端 + 插件 npm 构建),镜像约 3–5 GB,需要网络(node-gyp 头文件与依赖下载)。

## 运行 / run

网关部署(web 常驻,默认):

```sh
export DEEPSEEK_API_KEY=sk-...
export DSH_TRUSTED_HOSTS="gw.example.com:31688"            # 网关 authority,浏览器经网关访问时必需
export PPT_STUDIO_PREVIEW_BASE_URL="https://gw.example.com:31688/ppt-studio"
./docker/run.sh
```

网关把一个端口转发到 docker 机器的 `${DSH_PORT:-3080}`;验证:`curl http://127.0.0.1:3080/` 返回 web UI、`curl -I http://127.0.0.1:3080/ppt-studio/` 返回预览服务。

一次性任务(headless,不需要任何端口):

```sh
export DEEPSEEK_API_KEY=sk-...
./docker/run.sh --headless "做一份介绍深度学习的PPT,输出到 /data/decks"
```

只跑预览服务或透传 dsh CLI:

```sh
./docker/run.sh --preview
./docker/run.sh -- --profile web --dump-config | grep dsh-ppt-studio   # 验证插件层
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 无 | 模型调用凭据,宿主设置后由 `run.sh` 透传 |
| `DEEPSEEK_BASE_URL` | 公网 API | 内网网关地址;`.env` 是引导保留名,只能用真实环境变量 |
| `DSH_PORT` | `3080` | 宿主发布端口(网关转发目标) |
| `DSH_TRUSTED_HOSTS` | 空 | 空格分隔的网关 authority(host 或 host:port),加入 web 应用 `/api` 浏览器信任栅栏 |
| `PPT_STUDIO_OUTPUT_DIR` | `/data/decks` | deck 工作区根目录,挂载卷持久化 |
| `PPT_STUDIO_PREVIEW_PORT` | `3170` | 预览服务端口(容器内) |
| `PPT_STUDIO_PREVIEW_BASE_URL` | `http://127.0.0.1:3170` | 生成预览链接的前缀;经网关时设为 `https://<网关>:<端口>/ppt-studio` |
| `DECKS_DIR` | `./docker-decks` | 宿主 deck 目录,挂到 `/data/decks` |
| `CONTAINER_NAME` | `dsh-ppt-studio` | 容器名与 harness home 卷名前缀 |

## 卷

- `<容器名>-home:/root/.dsh` — harness home(profiles 与会话数据持久化;换新卷时入口脚本会自动重新注册插件)
- `${DECKS_DIR}:/data/decks` — deck 工作区,宿主可直接取产物(含 PPTX)

## 插件说明

插件注册走 `dsh plugin --profile <name> add /opt/dsh/plugins/dsh-ppt-studio` 的标准路径(`pnpm link` 语义),注册后 `dsh.profile.bundles` 含 `dsh-ppt-studio`,会话内可见 19 个 `ppt_*` 工具与 dsh-ppt-studio 技能。插件的完整接入说明见 [plugins/dsh-ppt-studio/README.md](../plugins/dsh-ppt-studio/README.md);`plugins/` 目录由外部源码仓 tar 同步,不要在这里直接改它的文档。
