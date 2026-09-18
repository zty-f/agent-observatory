# Agent Observatory

[![Checks](https://github.com/zty-f/agent-observatory/actions/workflows/checks.yml/badge.svg)](https://github.com/zty-f/agent-observatory/actions/workflows/checks.yml)

[English](README.md) · [简体中文](README.zh-CN.md)

一个在本机查看、搜索和管理 Codex、Claude Code、OpenClaw 与 Pi 会话的观察台。

Agent Observatory 扫描 Mac 上的会话文件，按项目和 Agent 整理，展示最近写入的事件和对话内容。对能够安全处理的会话，它提供可恢复的废纸篓操作。它不会运行 Agent，也不会调用模型 API。

## 快速开始

**要求：** macOS、Node.js 22 或更新版本，以及至少一种已在本机保存会话的受支持 Agent。运行时不需要安装 npm 依赖。

```bash
git clone https://github.com/zty-f/agent-observatory.git
cd agent-observatory
npm start
```

打开 <http://127.0.0.1:4180>。服务只监听 `127.0.0.1`。页面没有用户登录认证，请不要将端口转发到外网，也不要放在公网反向代理之后。

要作为 macOS 当前用户的后台服务运行，执行 `./start.sh`；使用 `./stop.sh` 或页面电源按钮停止。脚本只针对观察台进程，不会停止各个 Agent。可以用 `AGENT_OBSERVATORY_PORT=4181 npm start` 更换端口。

## 功能与支持范围

- 按标题、Agent、项目、路径和消息摘要搜索，并在本机查看已记录的对话。
- 按工作目录归类；根据最近的 JSONL 事件推断活动状态。“正在运行”不是进程或模型服务的健康检查。
- 归档 Codex 会话，将符合条件的会话移入 macOS 废纸篓、恢复（原路径可用时恢复到原位置），或明确删除废纸篓记录。
- 为受支持的会话复制 `codex resume` 或 `claude --resume` 命令。
- 浏览器每八秒刷新；支持明暗主题和列表、网格视图。

| Agent | 会话来源 | 从观察台移入废纸篓及恢复 | 恢复命令 |
| --- | --- | --- | --- |
| Codex | `~/.codex/sessions`、`~/.codex/archived_sessions` | 会话文件、原生索引与历史、桌面侧栏目录 | 支持 |
| Claude Code | `~/.claude/projects/**/*.jsonl` | 会话文件 | 支持 |
| OpenClaw | `~/.openclaw/agents/**/sessions/*.jsonl` | 仅限未被路由引用的历史文件 | 暂不提供 |
| Pi | `~/.pi/agent/sessions/**/*.jsonl` | 会话文件 | 暂不提供 |

仍被 OpenClaw 的 `sessions.json` 路由引用的会话**不能从页面移入废纸篓**，否则会留下失效入口。观察台会同步 Codex 的持久记录，但已打开的 ChatGPT/Codex 窗口可能暂时保留内存中的侧栏条目，需要完全退出再打开。Claude Code 和 Pi 的文件操作不保证其正在运行的客户端立即刷新。详细边界见[隐私声明](PRIVACY.zh-CN.md)。

如需指定 Pi 的位置，可设置 `PI_CODING_AGENT_DIR`（Agent 目录）或 `PI_CODING_AGENT_SESSION_DIR`（会话目录）；后者优先。

## 安全与隐私

页面会读取本机的提示词、回答、工具输出、时间和路径，这些记录可能包含密钥。观察台自身没有账户、遥测、Cookie、外部字体或模型 API 调用。会话内容仅由本机 HTTP 接口传给本机浏览器；界面偏好保存在 `localStorage`，废纸篓索引和可选的 Codex 历史快照保留在本机。服务不认证本机用户；在这里删除会话，也不能清除其他软件、备份或已打开客户端内存里的副本。

分享截图、日志或页面访问权限前，请阅读[隐私声明](PRIVACY.zh-CN.md)（[English](PRIVACY.md)）及[安全政策](SECURITY.md)。**不要把原始会话文件上传到公开 Issue。**

## API 与开发

页面使用本地接口：`GET /api/health`、`/api/agents`、`/api/sessions`、`/api/conversation/:id`，以及 `POST /api/action`。服务只接受本机 Host 和同源浏览器请求；接口不是带远程身份认证的服务。

```bash
npm test
npm start
```

`npm test` 检查 JavaScript 语法并运行 HTTP 隐私与安全测试。项目使用 Node 内置 HTTP 服务和原生浏览器 JavaScript。`server.js` 读取会话并执行操作，`app.js` 渲染界面，`codex-trash-state.py` 保存和恢复 Codex 元数据，`start.sh`、`stop.sh` 管理 macOS 后台服务。

## 参与贡献与反馈

提交 PR 前请阅读[参与贡献指南](CONTRIBUTING.zh-CN.md)和[社区行为准则](CODE_OF_CONDUCT.md)。反馈问题或建议请使用 [Issue 模板](https://github.com/zty-f/agent-observatory/issues/new/choose)，先删去私人路径和会话内容。安全漏洞请按[安全政策](SECURITY.zh-CN.md)私密报告。

项目目前以 macOS 为主。Agent 的格式及桌面索引可能变化；新增 Agent 支持或删除、恢复流程，需要提供对应格式证据和往返验证。复用条款见 [LICENSE](LICENSE)。
