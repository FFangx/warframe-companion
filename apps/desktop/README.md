# Warframe Companion Desktop

Electron/React 桌面应用默认打开总览与右侧助手，左侧默认仅有总览，默认缩成图标栏，顶部 ‹ / › 可展开或收起；“添加功能”支持固定和取消固定市场。右上角的全局助手可收起或放大，窄窗口切换显示。导航展开、市场固定和助手开关通过本机 localStorage 记住，查询与会话仍仅保留在内存。总览提供市场快捷查询、掉落查询示例与本次行情记录；活动、周常和个人数据仍待接入。

总览中的市场快捷查询要求显式输入物品、平台、跨平台开关与等级，通过安全 preload IPC 调用真实只读 `market-query-service`。结果分别展示当前买卖挂单、90 日已成交统计、证据时间、来源、警告、空订单和分类故障；不会下单、挂单或发送交易私聊。

助手使用 `@warframe-companion/agent-runtime`。用户可在设置弹窗中选择本地离线 profile，或保存 OpenAI-compatible 本机 profile，查看能力与健康状态，再沿“可信策略 → 模型 adapter → 工具调用 → 工具结果 → 证据回答 → `AgentTrace`”运行；支持 `market.query` 与 `drops.search`、停止和 15 秒超时。模型配置位于 Electron `userData/config/model-profiles.v1.json`，只含凭据环境变量引用，不含 key；掉落数据位于 `userData/public-data`。支持工具结果回送的 adapter 已能接收脱敏摘要并生成后续回答。当前没有接入视觉、模型 fallback、OpenClaw/DeepSeek 桌面 backend、个人快照或订阅写入；真实远程模型桌面试用尚未完成。

Agent 对话使用 `MarketResultCard` 摘要，保留价格、范围、来源与时间；点击后在主工作区展开同一快照的完整订单与统计，不触发重复查询。快捷查询也复用完整卡片。查询失败可重试；名称有候选时可选择并发送新查询。行情展示数据只保留在桌面会话中，不加入模型或执行轨迹。已打开的页面在切换时保留，因此查询可以在其他页面打开期间完成，返回后仍能查看或停止；关闭应用不保留会话历史。

当前按现有助手的功能对照表搭建桌面原型。D1a 已完成，下一步 D1b 补订单分页、筛选、私聊预览与显式复制；随后逐项接掉落/遗物、世界状态/周常/商店、个人数据与决策、愿望单/订阅。入口与模型体验随功能改善。安装发布与跨仓库重构不作为前置，见 [开发计划](../../docs/DEVELOPMENT_PLAN.md)。

## 开发

```powershell
npm run start -w @warframe-companion/desktop
npm run build -w @warframe-companion/desktop
```

设置 → 连接与诊断默认探测 `127.0.0.1:18789` 的 OpenClaw Gateway 和 Warframe.Market 公共接口。WFInfo 与 AlecaFrame 不猜测本机安装路径，可通过以下环境变量显式配置：

- `WARFRAME_COMPANION_WFINFO_EXE`
- `WARFRAME_COMPANION_ALECAFRAME_DIR`
- `WARFRAME_COMPANION_OPENCLAW_HOST`
- `WARFRAME_COMPANION_OPENCLAW_PORT`
- `WARFRAME_COMPANION_BUILD_ID`

所有探针、市场查询与 Agent 工具均只读；renderer 仅能通过 preload 暴露的类型化 IPC 读取/保存本机 profile、检查模型、运行 Agent 和取消，未启用 Node 集成。Base URL 必须是 HTTPS 或本机回环 HTTP；界面只接受环境变量名，绝不接受 key 值。
