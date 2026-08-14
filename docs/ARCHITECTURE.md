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
│ Deterministic Warframe Core│  │ Agent Runtime       │
│ 查询｜订阅｜快照｜卡片数据  │  │ 当前：OpenClaw      │
│ 现有 Node 脚本逐步模块化    │  │ 实验：DeepSeek      │
└───────┬───────────┬────────┘  │ Harness adapter      │
        │           │           └─────────────────────┘
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

### 3. Agent 适配层

业务工具不绑定某个模型或 Harness：

```text
OpenClaw adapter          ┐
DeepSeek Harness adapter ─┼─> typed tool contracts
Deterministic eval runner ┘
```

DeepSeek Harness 在 Developer Preview 阶段只做隔离实验，不成为第一版硬依赖。相同评估集用于比较工具选择、证据合规、权限和延迟。

### 4. 渠道呈现

- 桌面端使用 React 原生组件，支持筛选、复制、展开证据和诊断。
- QQ 继续生成固定 PNG/文字，维持确定性直投和去重。
- 两个渠道共享业务数据结构，不共享最终视觉产物。

## 第一阶段技术选择

- 桌面：Electron Forge、React、TypeScript、Vite。
- 本地 API：Node/TypeScript；先选进程内接口或仅监听 `127.0.0.1` 的本地服务。
- 事件：先定义最小事件集合，暂不强制引入 AG-UI。
- 数据：现有 JSON 状态保持兼容；新桌面会话和诊断数据需要持久化时再引入 SQLite。
- Agent：OpenClaw 保持当前生产入口；DeepSeek Harness 作为适配实验。
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
- React 原生行情卡已经展示买卖挂单、90 日已成交统计、查询证据、警告、空订单语义和分类故障；不复用 QQ PNG，也不暴露 Node 或原始上游响应。
- `packages/agent-eval` 已建立首批 30 条合成/脱敏评估、模型无关结构化轨迹协议、确定性评分 runner 和参考契约基线；覆盖工具路由、参数、事实、证据、权限与效率。参考基线只验证评估器上界，不代表真实模型表现。
- `packages/agent-runtime` 已实现桌面生产与 eval 共用的确定性 Agent Harness：公开市场工具编排、参数澄清、权限拒绝、流式事件和 `AgentTrace` 导出。桌面通过受限 IPC 展示同一路径的工具轨迹；评估包以合成工具结果驱动该 Runtime，生成首份非 oracle Harness 基线。
- DeepSeek Harness 的隔离适配器现位于 `experiments/deepseek-harness`：外置 Cordis 工具将 `market_query` 映射为逻辑 `market.query`，可信上下文 guard 拒绝权限负例，终态工具通过 `concludeTurn()` 提交模型判断；驱动器从正式 `session/event` 派生业务调用、从 `tools/result` 观察规范结果并输出同一 `AgentTrace`。keyless DSH 组合预检已通过；它不进入桌面生产依赖，也不修改 DSH `agent-loop`。当前缺少模型凭据，尚无真实 DeepSeek 成绩。固定版本、许可与运行边界见 [`DEEPSEEK_HARNESS_BASELINE.md`](DEEPSEEK_HARNESS_BASELINE.md)。
- renderer 启用 `contextIsolation` 与 sandbox，关闭 Node 集成；健康状态携带范围、检查时间、新鲜度、finding 和来源。
- 最小 Agent 对话已经实现；当前不包含 LLM、OpenClaw/DeepSeek 适配、个人快照、订阅或会话持久化，不得把这些能力视作已经交付。
