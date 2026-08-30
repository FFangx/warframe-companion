# Warframe Companion

[![CI](https://github.com/FFangx/warframe-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/FFangx/warframe-companion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

> **当前状态：早期开发版。** 源码与可重复验证流程公开，但尚未发布经过安装、升级、卸载和实机验收的 Windows 安装包。不要把源码测试通过等同于可安装产品已经发布。

一个 Windows 本地优先、只读、证据驱动的 Warframe 国际服个人助手。目标是把现有确定性查询、个人快照、订阅诊断和 Agent 能力交付为可安装桌面应用，同时保留 QQ/OpenClaw 作为远程渠道。

当前已完成市场、公共掉落数据与 Agent 桌面垂直切片：`market.query`、带缓存/源年龄双维度和替代源对照的版本化 `drops.search`、许可证明确的中英文别名层、真实只读适配器、Electron/React 桌面应用、系统健康页、原生市场查询卡、流式 Agent 对话，以及 38 条合成/脱敏 eval、确定性 runner、参考基线、真实桌面 Harness 基线与 OpenAI-compatible 合同 mock 基线。

桌面 Agent 的稳定核心现由 Companion 自有的 Warframe Harness 承载：`ModelProfile`、`ModelAdapter`、能力/健康门禁、可信策略、工具执行、取消/超时和轨迹。除两个零费用本地规则 profile 外，桌面现可保存本机 OpenAI-compatible profile：只持久化 Base URL、模型名、能力声明和凭据环境变量引用，不保存 key；适配器支持 `/models` 健康检查、Chat Completions 结构化工具、SSE、取消与稳定错误分类。支持工具结果回送的 adapter 在每次工具执行后收到脱敏结果摘要，用文本回答或内部 `agent.conclude` 提交 `answered`/`insufficient_data` 终态——事实、证据、身份、拒绝与延迟永远由 Harness 决定，第二轮故障回落确定性回答。未经用户主动配置和发送，不调用远程模型。详见 [`docs/AGENT_HARNESS.md`](docs/AGENT_HARNESS.md)。

DeepSeek Harness 已完成固定上游提交的独立审计、原样构建，以及隔离插件/门禁/事件适配器的 keyless 预检。固定候选的 v1 0/30、20.22% 与同 trace 的 v2 5/30、53.72% 仅保留为 DSH 集成冒烟和评分协议演进历史：运行配置、隐藏默认参数与名称规范化契约都不足以支持模型、框架或 Harness 选型比较。[v1/v2 对比](packages/agent-eval/reports/v2/v1-v2-comparison.md)已明确这一降级定位。

## 仓库结构

```text
docs/                           产品、架构、作品集与 Session 约定
packages/market-query-contract  market.query 类型、错误、脱敏 mock 与契约测试
packages/market-query-service   Warframe.Market v2 真实适配器、证据映射与故障测试
packages/warframe-data-service  WFCD 公共掉落快照、原子本地缓存与内存索引
packages/agent-runtime          桌面生产与 eval 共用的流式 Agent Harness
packages/agent-eval             38 条合成评估、结构化轨迹 runner 与基线报告
apps/desktop                    Electron/React 桌面应用、健康页、市场卡与 Agent 对话
experiments/deepseek-harness    固定 DSH 的隔离工具/策略/轨迹实验与对比报告
```

后续按经过验收的 Session 增加桌面应用与评估包，不提前铺设空实现。

## 开发验证

要求 Node.js 22 或更高版本：

```powershell
npm ci
npm run check:repo
npm run build
npm test
npm run eval --workspace @warframe-companion/agent-eval
npm audit --omit=dev --audit-level=high
npm run smoke:live --workspace @warframe-companion/warframe-data-service
npm run start -w @warframe-companion/desktop

# 隔离 DSH 实验（独立 lockfile）
npm ci --prefix experiments/deepseek-harness
npm test --prefix experiments/deepseek-harness
npm run preflight --prefix experiments/deepseek-harness
```

## 安全边界

- 只读处理 Warframe、AlecaFrame 和市场数据，不自动操作游戏、交易、聊天或账号资产。
- 不提交 API Key、Market Token、QQ 标识、AlecaFrame 解密密钥、原始个人快照、真实聊天或本机日志。
- 状态性结论必须带匹配对象、范围、时间、新鲜度和来源的确定性证据。
- Mock、评估集、截图与演示数据必须合成或完成脱敏。

安全问题请通过 [SECURITY.md](SECURITY.md) 中的私有漏洞报告渠道提交，不要在公开 issue 中附带凭据、个人数据或漏洞细节。

详细定义见 [产品文档](docs/PRODUCT.md) 与 [目标架构](docs/ARCHITECTURE.md)。验收分层见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)，已知依赖风险见 [docs/DEPENDENCY_RISK.md](docs/DEPENDENCY_RISK.md)，贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 相关仓库边界

- `openclaw-warframe-assistant`：当前生产 QQ/OpenClaw 渠道适配与运行时 Skill。
- `WFInfo-CN-DPI-Fix`：WFInfo 独立程序及其游戏内奖励辅助能力。
- `deepseek-harness`：与本仓库同级的固定上游调研副本；仅用于旁路插件实验，不是桌面稳定链路依赖。
- 本仓库：共享契约、应用服务、桌面应用和 Agent 评估体系。

## License 与支持

代码采用 [MIT License](LICENSE)。Warframe、相关游戏数据、名称与商标的归属及第三方数据边界见 [NOTICE.md](NOTICE.md)。本项目是个人维护的业余项目，没有 SLA，详见 [SUPPORT.md](SUPPORT.md)。
