# 桌面 Agent Runtime

桌面端与 Agent eval 共用的最小确定性 Harness。它只编排公开只读 `market.query`、显式参数澄清和权限拒绝，逐步导出流式事件与 `AgentTrace`。当前不是 LLM，也不接触个人快照、订阅写入、QQ 或游戏客户端。
