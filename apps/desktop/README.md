# Warframe Companion Desktop

Electron/React 桌面应用当前提供系统健康页、原生市场查询卡与最小 Agent 对话，不包含个人数据视图。

市场页要求显式输入物品、平台、跨平台开关与等级，通过安全 preload IPC 调用真实只读 `market-query-service`。结果分别展示当前买卖挂单、90 日已成交统计、证据时间、来源、警告、空订单和分类故障；不会下单、挂单或发送交易私聊。

Agent 页使用 `@warframe-companion/agent-runtime`。用户可选择本地离线 profile，或在界面保存 OpenAI-compatible 本机 profile，查看能力与健康状态，再沿“可信策略 → 模型 adapter → 工具调用 → 工具结果 → 证据回答 → `AgentTrace`”运行；支持 `market.query` 与 `drops.search`、停止和 15 秒超时。模型配置位于 Electron `userData/config/model-profiles.v1.json`，只含凭据环境变量引用，不含 key；掉落数据位于 `userData/public-data`。支持工具结果回送的 adapter 已能接收脱敏摘要并生成后续回答。当前没有接入视觉、模型 fallback、OpenClaw/DeepSeek 桌面 backend、个人快照或订阅写入；真实远程模型桌面试用尚未完成。

当前按现有助手的功能对照表搭建桌面原型。下一步是把共享行情卡接入 Agent，保留切页后的会话与结果并补订单操作；随后逐项接掉落/遗物、世界状态/周常/商店、个人数据与决策、愿望单/订阅。入口与模型体验随功能改善。以上仍为待开发内容；安装发布与跨仓库重构不作为功能接入前置，见 [开发计划](../../docs/DEVELOPMENT_PLAN.md)。

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

所有探针、市场查询与 Agent 工具均只读；renderer 仅能通过 preload 暴露的类型化 IPC 读取/保存本机 profile、检查模型、运行 Agent 和取消，未启用 Node 集成。Base URL 必须是 HTTPS 或本机回环 HTTP；界面只接受环境变量名，绝不接受 key 值。
