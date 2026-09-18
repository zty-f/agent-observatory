# 安全政策

[English](SECURITY.md) · [简体中文](SECURITY.zh-CN.md)

## 支持范围

安全修复以最新的 `main` 分支为目标。本项目尚未经过独立安全审计；旧提交和 Fork 不保证得到修复。

## 私密报告漏洞

请使用 GitHub 的[私密漏洞报告入口](https://github.com/zty-f/agent-observatory/security/advisories/new)。仓库已启用该功能。尚未修复的漏洞请不要发到公开 Issue。报告可写明受影响的提交或版本、影响、复现步骤及最小的**合成测试数据**；不要发送真实会话文件、密钥或完整的私人目录路径。维护者会检查报告并协调修复，但目前不承诺固定响应时间。

普通错误可使用[公开 Issue 模板](https://github.com/zty-f/agent-observatory/issues/new/choose)，先对数据脱敏。如果 GitHub 私密报告入口不可用，可以先发一个不披露漏洞细节的公开 Issue，询问私密联系方式。

## 本机威胁模型

观察台会处理敏感的本机会话文本。HTTP 服务仅监听 `127.0.0.1`，限制 Host 和浏览器 Origin，不开放跨域读取，只提供页面必需的静态文件。它**不会**认证同一台电脑上的其他进程或用户。请保持端口仅供本机使用，不要用端口转发、隧道或反向代理发布。数据读取与保存范围见[隐私声明](PRIVACY.zh-CN.md)。
