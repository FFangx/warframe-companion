# 桌面 Agent Runtime

Companion 自有 Warframe Agent Harness 的第一条模型可配置切片。它定义 `ModelProfile`、`ModelAdapter` 与能力/健康门禁，由 Harness 统一执行可信策略、公开只读 `market.query`、取消/超时、流式事件和 `AgentTrace`。

当前 backend `warframe-local-rules` 完全离线、零密钥，提供标准与紧凑两个可选 profile；它用于验证产品链路，不代表 LLM。尚未接入视觉、远程模型、fallback、个人快照、订阅写入、QQ 或游戏客户端。架构边界见 [`docs/AGENT_HARNESS.md`](../../docs/AGENT_HARNESS.md)。
