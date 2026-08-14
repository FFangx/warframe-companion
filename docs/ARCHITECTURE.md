# Warframe Companion Agent 目标架构

> 状态：方向性架构，2026-08-14。描述目标边界，不代表全部已经实现。

## 总体结构

```text
┌─────────────────────────────────────────────────────┐
│ Windows Desktop：Electron + React + TypeScript      │
│ 仪表盘｜原生结果卡｜Agent 对话｜订阅｜诊断          │
└───────────────────────┬─────────────────────────────┘
                        │ typed local API + event stream
┌───────────────────────▼─────────────────────────────┐
│ Local Application Service                           │
│ 工具契约｜鉴权策略｜证据封装｜会话事件｜进程健康     │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
┌──────────────▼─────────────┐  ┌────▼────────────────┐
│ Deterministic Warframe Core│  │ Warframe Agent Harness│
│ 查询｜订阅｜快照｜卡片数据  │  │ profile｜adapter｜loop│
│ 现有 Node 脚本逐步模块化    │  │ policy｜events｜trace │
└───────┬───────────┬────────┘  └──────────┬───────────┘
┌───────▼──────┐ ┌──▼──────────┐
│ AlecaFrame   │ │ WFInfo / API│
│ 本机只读快照  │ │ 公共数据源   │
└──────────────┘ └─────────────┘

QQ Bot ── OpenClaw adapter ──┐
                             └── 共用 Local Application Service
```

## 四个稳定边界

### 1. 工具契约

桌面、QQ 和不同 Agent Harness 不直接依赖脚本命令行文本。应用服务暴露类型化操作，例如：

```ts
market.query({ item: "古纪 V3", rank: 0 })
subscriptions.list()
account.getSnapshot()
system.getHealth()
```

第一阶段允许适配器内部继续调用现有 `dispatch.mjs`、`lookup.mjs` 等脚本，但调用者看不到命令行细节。

### 2. 统一结果封装

```ts
export interface ToolResult<TData, TPresentation = unknown> {
  data: TData;
  evidence: {
    scope: string;
    evidenceType: string;
    asOf: string;
    expiresAt?: string;
    freshness: "fresh" | "stale" | "unknown";
    finding: string;
    source: string;
  };
  presentation?: {
    kind: string;
    payload: TPresentation;
  };
  warnings?: string[];
}
```

- `data` 是业务事实，供程序和评估读取。
- `evidence` 约束模型和 UI 能得出什么状态性结论。
- `presentation` 是渠道无关的展示数据；React 和 QQ PNG 使用不同渲染器。
- 错误必须分类，不以空数组同时表示“没有结果”和“数据源不可用”。

### 3. Warframe Agent Harness

业务工具和桌面产品不绑定某个 provider。Companion 自己拥有 `ModelProfile`、`ModelAdapter`、能力路由、可信策略、Agent loop、事件、取消/超时和轨迹边界：

```text
local rules adapter       ┐
OpenAI-compatible adapter ┼─> Companion Harness ─> typed Warframe tools
OpenClaw / DSH backend    ┘
```

当前只有离线 `warframe-local-rules` backend，用来零费用验证第一条桌面链路。DeepSeek Harness 的 Developer Preview 集成继续是隔离历史实验，不成为第一版硬依赖，也不由单次模型分数决定架构选型。完整边界见 [`AGENT_HARNESS.md`](AGENT_HARNESS.md)。

### 4. 渠道呈现

- 桌面端使用 React 原生组件，支持筛选、复制、展开证据和诊断。
- QQ 继续生成固定 PNG/文字，维持确定性直投和去重。
- 两个渠道共享业务数据结构，不共享最终视觉产物。

## 第一阶段技术选择

- 桌面：Electron Forge、React、TypeScript、Vite。
- 本地 API：Node/TypeScript；先选进程内接口或仅监听 `127.0.0.1` 的本地服务。
- 事件：先定义最小事件集合，暂不强制引入 AG-UI。
- 数据：公共静态数据先用版本化 JSON 快照与内存索引；存储藏在类型化服务接口后。只有真实负载需要事务性用户状态、跨表查询、原子增量更新，或实测超过启动内存/延迟预算时才引入 SQLite，详见 [`LOCAL_DATA_LAYER.md`](LOCAL_DATA_LAYER.md)。
- Agent：Companion 自有 Warframe Harness 承载桌面产品；OpenClaw 保持现有 QQ 生产入口并作为能力/运维参考；DeepSeek Harness 只保留隔离适配实验。
- 发布：延续受管构建身份、哈希校验、统一验证和可恢复升级原则。

## 实施顺序

1. 定义并实现 `market.query` 类型化垂直切片。
2. 建立最小桌面壳和系统健康页面。
3. 用 React 原生市场卡完成真实查询。
4. 抽取通用错误、证据和展示协议。
5. 接入 Agent 对话和流式事件。
6. 逐项迁移现有功能，保持 QQ 行为不回退。
7. 最后进行 DeepSeek Harness 旁路适配与对比评估。

## 当前实现切片

- `market.query` 类型化契约与真实只读 Warframe.Market 适配器已经实现。
- `apps/desktop` 已实现 Electron/React/TypeScript/Vite 最小桌面壳。
- `system.getHealth()` 当前通过安全 preload IPC 暴露桌面构建、OpenClaw 本机端口、WFInfo 配置路径、AlecaFrame 配置路径和 Warframe.Market 公共源的只读健康快照。
- 桌面市场页通过独立的 `market.query()` preload IPC 调用主进程内 `market-query-service`；用户必须显式输入物品、平台、跨平台范围和等级。
- `packages/warframe-data-service` 已实现第一条本地公共数据切片：按需验证并编译 WFCD 掉落快照，以原子 JSON 缓存和内存键索引支持 `drops.search`。契约分别报告 24 小时缓存新鲜度与 WFCD 源数据年龄；源数据 30 天后告警、90 天后门禁拒绝。刷新会对照同一 MIT 仓库的 jsDelivr/GitHub Raw 元数据并记录版本差异与选源。刷新失败只能在源年龄仍通过门禁时显式使用 stale 快照；无有效掉率的源行会计数、排除并告警，不会静默当作 0。
- 公共掉落别名采用仓库自维护的中英文小表，随项目 MIT 发布并在解析结果中携带来源/许可证；未摄取无明确许可证的中文公共导出。
- React 原生行情卡已经展示买卖挂单、90 日已成交统计、查询证据、警告、空订单语义和分类故障；不复用 QQ PNG，也不暴露 Node 或原始上游响应。
- `packages/agent-eval` 已建立 38 条合成/脱敏评估（原 30 条加 8 条 `drops.search`）、模型无关结构化轨迹协议、确定性评分 runner 和参考契约基线；掉落用例覆盖中英文路由、缓存/源年龄分离、替代源对照、过龄拒绝与无源降级。参考基线只验证评估器上界，不代表真实模型表现。
- `packages/agent-runtime` 已实现 Companion 自有 Harness 的模型可配置切片：`ModelProfile`、`ModelAdapter`、能力/健康门禁、本地离线 backend、可信策略、公开市场/掉落工具编排、取消/超时、流式事件和 `AgentTrace`。受控 OpenAI-compatible adapter 通过只含引用的凭据契约支持 `/models` 健康检查、Chat Completions JSON Schema 工具、SSE、取消和稳定错误；桌面本机 profile 使用原子 JSON 配置，不引入 SQLite。默认仍只运行零费用离线 profile，真实 provider 仅在用户主动配置与发送后调用。
- DeepSeek Harness 的隔离适配器现位于 `experiments/deepseek-harness`：外置 Cordis 工具将 `market_query` 映射为逻辑 `market.query`，可信上下文 guard 拒绝权限负例，终态工具通过 `concludeTurn()` 提交模型判断；驱动器从正式 `session/event` 派生业务调用、从 `tools/result` 观察规范结果并输出同一 `AgentTrace`。keyless DSH 组合预检与固定候选的 30 条真实模型评估均已完成；首份 v1 `deepseek-v4-flash` 基线保持 0/30、20.22%。版本化 v2 runner 离线读取同一批 trace 后为 5/30、53.72%，并将工具后 `answer` 终态、必需/禁止事实语义和远程模型延迟预算从 v1 系统性误差中分离；无支撑事实、证据与权限门禁未放宽。它不进入桌面生产依赖，也不修改 DSH `agent-loop`。固定版本、许可与运行边界见 [`DEEPSEEK_HARNESS_BASELINE.md`](DEEPSEEK_HARNESS_BASELINE.md)。
- renderer 启用 `contextIsolation` 与 sandbox，关闭 Node 集成；健康状态携带范围、检查时间、新鲜度、finding 和来源。
- 模型可配置的最小 Agent 对话和 OpenAI-compatible 接口已经实现；当前未用真实远程模型验收，也不包含视觉、OpenClaw/DSH 桌面 backend、fallback、个人快照、订阅、会话持久化或工具结果回送模型的多轮生成，不得把这些能力视作已经交付。
