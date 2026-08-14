# Warframe Companion Desktop

Electron/React 桌面应用当前提供系统健康页、原生市场查询卡与最小 Agent 对话，不包含个人数据视图。

市场页要求显式输入物品、平台、跨平台开关与等级，通过安全 preload IPC 调用真实只读 `market-query-service`。结果分别展示当前买卖挂单、90 日已成交统计、证据时间、来源、警告、空订单和分类故障；不会下单、挂单或发送交易私聊。

Agent 页使用 `@warframe-companion/agent-runtime`。用户可选择本地离线模型 profile，查看能力与健康状态，再沿“可信策略 → 模型 adapter → 工具调用 → 工具结果 → 证据回答 → `AgentTrace`”运行；支持 `market.query` 与 `drops.search`、停止和 15 秒超时。掉落工具按需下载 WFCD 公共快照并在 `userData/public-data` 原子缓存，不包含个人数据。当前不是远程 LLM，也没有接入视觉、fallback、OpenClaw、DeepSeek、个人快照或订阅写入。

## 开发

```powershell
npm run start -w @warframe-companion/desktop
npm run build -w @warframe-companion/desktop
```

健康页默认探测 `127.0.0.1:18789` 的 OpenClaw Gateway 和 Warframe.Market 公共接口。WFInfo 与 AlecaFrame 不猜测本机安装路径，可通过以下环境变量显式配置：

- `WARFRAME_COMPANION_WFINFO_EXE`
- `WARFRAME_COMPANION_ALECAFRAME_DIR`
- `WARFRAME_COMPANION_OPENCLAW_HOST`
- `WARFRAME_COMPANION_OPENCLAW_PORT`
- `WARFRAME_COMPANION_BUILD_ID`

所有探针、市场查询与 Agent 工具均只读；renderer 仅能通过 preload 暴露的 `system.getHealth()`、`market.query()` 与 `agent.run()` 调用类型化 IPC，未启用 Node 集成。
