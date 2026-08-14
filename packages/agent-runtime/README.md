# 桌面 Agent Runtime

Companion 自有 Warframe Agent Harness 的第一条模型可配置切片。它定义 `ModelProfile`、`ModelAdapter` 与能力/健康门禁，由 Harness 统一执行可信策略、公开只读 `market.query` / `drops.search`、取消/超时、流式事件和 `AgentTrace`。掉落回答分别保留缓存新鲜度、源数据年龄、替代源对照与过龄门禁事实。

当前 backend 包括完全离线、零密钥的 `warframe-local-rules`，以及受控 `openai-compatible` adapter。后者的本机配置只保存凭据引用，支持 `/models` 健康检查、Chat Completions 结构化工具、SSE、取消与稳定错误分类；合同测试只使用本地合成 transport。尚未用真实模型验收，也未接入视觉、fallback、个人快照、订阅写入、QQ 或游戏客户端。架构边界见 [`docs/AGENT_HARNESS.md`](../../docs/AGENT_HARNESS.md)。
