# Warframe Companion Desktop

Electron/React 桌面应用当前提供系统健康页与原生市场查询卡，不包含 Agent 对话或个人数据视图。

市场页要求显式输入物品、平台、跨平台开关与等级，通过安全 preload IPC 调用真实只读 `market-query-service`。结果分别展示当前买卖挂单、90 日已成交统计、证据时间、来源、警告、空订单和分类故障；不会下单、挂单或发送交易私聊。

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

所有探针与市场查询均只读；renderer 仅能通过 preload 暴露的 `system.getHealth()` 与 `market.query()` 调用类型化 IPC，未启用 Node 集成。
