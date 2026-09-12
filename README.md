# OpenGrok

本机 [Grok Build](https://x.ai/cli) 桌面工作台。通过 ACP（`grok agent stdio`）驱动本机 `grok` CLI，功能对齐 Grok For VS Code 插件，界面吸收 Codex / Grok App 的三栏工作台，但使用独立的 OpenGrok 视觉。

非 xAI 官方产品。Agent 运行时是你已经安装的 Grok CLI。

## 功能

- 流式对话、思考折叠、工具步骤、权限审批、Plan 审阅
- `/` 斜杠命令与 `@` 工作区文件
- 会话、MCP、插件、工作树、记忆、配置与登录
- 官方浏览器登录或 API Key
- 多项目文件夹，数据在 `%USERPROFILE%\.opengrok`，CLI 会话仍走 `~/.grok`

## 要求

- Windows 10+（已装 WebView/Chromium 随 Electron 分发）
- 本机 Grok CLI：`irm https://x.ai/cli/install.ps1 | iex`
- Node.js 20+（开发）

## 开发

```powershell
npm install
npm run dev
```

## 打包

```powershell
npm run pack
```

安装包输出到 `release/`。

## 源码

`plugin/` 来自作者自己的 Grok VS Code 插件（ACP 宿主 + 对话 UI）。`desktop/` 是 Electron 壳、窗控与 OpenGrok 工作台样式。
