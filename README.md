# Warframe Companion

一个 Windows 本地优先、只读、证据驱动的 Warframe 国际服个人助手。目标是把现有确定性查询、个人快照、订阅诊断和 Agent 能力交付为可安装桌面应用，同时保留 QQ/OpenClaw 作为远程渠道。

当前已完成市场与 Agent 两个桌面业务垂直切片：`market.query` 契约、真实只读 Market 适配器、Electron/React 桌面应用、系统健康页、原生市场查询卡、流式 Agent 对话，以及 30 条合成/脱敏 eval、确定性 runner、参考基线与真实桌面 Harness 基线。

DeepSeek Harness 已完成固定上游提交的独立审计、原样构建和无密钥最小运行；当前仅形成[旁路调研与集成基线](docs/DEEPSEEK_HARNESS_BASELINE.md)，尚未接入桌面运行时或生成真实模型成绩。

## 仓库结构

```text
docs/                           产品、架构、作品集与 Session 约定
packages/market-query-contract  market.query 类型、错误、脱敏 mock 与契约测试
packages/market-query-service   Warframe.Market v2 真实适配器、证据映射与故障测试
packages/agent-runtime          桌面生产与 eval 共用的流式 Agent Harness
packages/agent-eval             30 条合成评估、结构化轨迹 runner 与基线报告
apps/desktop                    Electron/React 桌面应用、健康页、市场卡与 Agent 对话
```

后续按经过验收的 Session 增加桌面应用与评估包，不提前铺设空实现。

## 开发验证

要求 Node.js 22 或更高版本：

```powershell
npm ci
npm test
npm run eval --workspace @warframe-companion/agent-eval
npm run start -w @warframe-companion/desktop
```

## 安全边界

- 只读处理 Warframe、AlecaFrame 和市场数据，不自动操作游戏、交易、聊天或账号资产。
- 不提交 API Key、Market Token、QQ 标识、AlecaFrame 解密密钥、原始个人快照、真实聊天或本机日志。
- 状态性结论必须带匹配对象、范围、时间、新鲜度和来源的确定性证据。
- Mock、评估集、截图与演示数据必须合成或完成脱敏。

详细定义见 [产品文档](docs/PRODUCT.md) 与 [目标架构](docs/ARCHITECTURE.md)。

## 相关仓库边界

- `openclaw-warframe-assistant`：当前生产 QQ/OpenClaw 渠道适配与运行时 Skill。
- `WFInfo-CN-DPI-Fix`：WFInfo 独立程序及其游戏内奖励辅助能力。
- `deepseek-harness`：与本仓库同级的固定上游调研副本；仅用于旁路插件实验，不是桌面稳定链路依赖。
- 本仓库：共享契约、应用服务、桌面应用和 Agent 评估体系。
