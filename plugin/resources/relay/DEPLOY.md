# Grok Web 部署

Grok Web 是 Grok Build 的公网中转。插件和浏览器都走 HTTP，**不需要 SSH**。

当前包默认：公网主机 `127.0.0.1`，监听端口 `8788`。

## 准备

- Node.js 18+
- 解压 `grok-web-*.zip`
- 若要从外网访问，防火墙放行 `8788`（或你改的端口）

## 启动

Windows：解压后运行 `start.cmd`。

Linux / macOS：

```bash
chmod +x start.sh
./start.sh
```

首次启动会在终端打印（**管理员密码只出现一次**）：

```text
grok web http://127.0.0.1:8788
admin http://127.0.0.1:8788/admin  user=admin
admin password (shown once): ……
custom plugin key: hostKey in ……/grok-web.json
```

- 控制面板：<http://127.0.0.1:8788/admin>
- 用户名：`admin`
- 配置文件默认：`~/.grok/web/grok-web.json`

给外网用时，登录控制面板，把「公网主机」改成这台机器的公网 IP 或域名。

## Linux systemd（可选）

```bash
sudo mkdir -p /opt/grok-web /var/lib/grok-web
sudo cp relay.js /opt/grok-web/
sudo cp grok-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now grok-web
```

配置目录为 `/var/lib/grok-web`。改完 `grok-web.service` 后执行 `sudo systemctl daemon-reload && sudo systemctl restart grok-web`。

## 环境变量与参数

| 作用 | 写法 |
| --- | --- |
| 换端口 | `start.cmd 9000` 或 `GROK_RELAY_PORT=9000` |
| 指定公网地址 | `GROK_RELAY_HOST=vps.example.com` |
| 监听网卡 | `GROK_RELAY_BIND=0.0.0.0`（默认） |
| 配置目录 | `GROK_WEB_HOME=/var/lib/grok-web` |
| 重置管理员密码 | `node relay.js --reset-admin` |
| 指定管理员密码 | `GROK_WEB_ADMIN_PASS`（至少 12 位） |

`GROK_RELAY_PORT` 若已设置，控制面板改端口不会当场切换，需重启进程。

## 控制面板

地址：`http://IP或域名:端口/admin`

可配置：

- 公网主机 / 域名
- 监听端口（默认 8788）
- 单帧上限、上传文件上限
- 轮换自定义中转密钥
- 踢出槽 / 踢出 IP / 拉黑 IP

丢失管理员密码时，在服务端目录执行：

```bash
node relay.js --reset-admin
```

会生成并再打印一次新密码。

`grok-web.json` 里的 `hostKey`（`gb1.…`）是**插件自定义中转密钥**，不是管理员密码。

## 插件怎么连

在 Grok Build 设置 → 远程访问 → 公网中转：

- **官方服务器**：什么都不填，连内置中转。
- **自定义服务器**：填这台机器的 IP 或域名，以及控制面板里的中转密钥。端口默认 8788；不是 8788 时再展开填写。

打开「公网开放」后，把插件给出的 `/s/…` 地址发给对方。对方用浏览器打开并填授权码即可，不用装插件。

## 密钥对照

| 东西 | 用途 |
| --- | --- |
| 管理员密码 | 登录 `/admin` |
| `hostKey`（`gb1.…`） | 自定义插件连接这台中转 |
| 授权码 | 浏览器打开公网对话 |

不需要 SSH 私钥或公钥。只有你要登上这台 Linux 改文件时，才用云厂商网页终端或 SSH。
