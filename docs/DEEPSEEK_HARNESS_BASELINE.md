# DeepSeek Harness 旁路调研与集成基线

> 状态：Session 8 已完成上游审计和边界设计；Session 9 已完成隔离 Companion 插件、门禁、事件适配器、keyless 预检与固定候选的 30 条真实模型评估；Session 10 已完成 v2 评估协议和既有 trace 离线重评。日期：2026-08-14。

## 固定的上游基线

| 项目 | 固定值 |
|---|---|
| 官方仓库 | `https://github.com/deepseek-ai/deepseek-harness.git` |
| 本机同级目录 | `../deepseek-harness` |
| 上游提交 | `47f943859bef60e4160492346772ded9b24f765a` |
| 上游分支位置 | 审计时为 `origin/master`；本机副本使用 detached HEAD 固定提交 |
| DSH 版本 | `0.1.0-rc.5` |
| Node 要求 | `^22.19.0 || >=24.0.0` |
| 包管理器 | `pnpm@11.7.0` |
| 根许可证 | MIT |

复现副本：

```powershell
git clone https://github.com/deepseek-ai/deepseek-harness.git ..\deepseek-harness
git -C ..\deepseek-harness switch --detach 47f943859bef60e4160492346772ded9b24f765a
git -C ..\deepseek-harness status -sb
```

不要把 `master`、`latest` 或未固定的 npm 标签当作评估身份。未来若升级，必须记录新提交、包版本、锁文件变化和新基线，不能覆盖本节中的首个基线。

## 已完成的原样验证

在 Windows x64、Node `v24.18.1` 上执行：

```powershell
corepack pnpm@11.7.0 install --frozen-lockfile
corepack pnpm@11.7.0 run build
corepack pnpm@11.7.0 dsh --help
corepack pnpm@11.7.0 dsh --profile headless --help
corepack pnpm@11.7.0 dsh --profile headless --dump-config
corepack pnpm@11.7.0 run verify-dsh-package-licenses
corepack pnpm@11.7.0 run verify-third-party-notices
```

结果：锁文件安装成功，完整源码构建成功；`headless` profile 能完成插件树组合并输出 334 行配置；222 个 DSH 包均声明 MIT，`THIRD_PARTY_NOTICES.md` 与锁文件一致。安装阶段的 Linux 原生包平台提示和构建前示例 bin 提示没有阻止安装；构建阶段的 tsdown/Rolldown 弃用与插件耗时提示没有阻止构建。没有配置或读取 `DEEPSEEK_API_KEY`，因此本轮没有把 CLI 帮助或配置加载误称为真实模型运行。

上游副本保持干净，只包含忽略的依赖与构建产物；没有修改或提交上游源码。

## 架构与插件机制结论

DeepSeek Harness 基于 vendored Cordis，模型适配器、工具注册表、会话日志和 Agent loop 都是插件。运行实例由 profile、bundle 和 `cordis.patch.yml` 按层组合。插件通过稳定的 `ctx.<service>` 键发现能力，通过 `inject` 声明加载依赖，并用 `ctx.effect()`、`ctx.on()` 或 registry disposer 保证卸载可逆。

与 Companion 集成直接相关的正式扩展点是：

- `ctx.tools.register()`：注册模型可见工具；输入由 DSH schema 校验，执行结果必须是声明过的规范 JSON 值。
- `tools/pre-execute`/`ctx.tools.guard()`：执行权限门禁；可信身份来自评估驱动器，模型参数不能声明权限。
- `tools/result`：观察已经标准化且不可变的工具结果，适合生成评估事实和错误分类。
- `session/event`：观察持久化的 turn、step、assistant 和 tool 事件，适合恢复模型行为和工具调用顺序。
- `ToolExecution.concludeTurn()`：让一次成功的终态提交在结果落盘后结束本轮。

不修改 `agent-loop`。上游明确要求新行为附着在插件和事件扩展点；改变 loop 会扩大兼容面，并违背本项目“旁路实验、不替换桌面稳定链路”的目标。

官方 `dsh --profile headless` 只承诺打印最后一条 assistant 文本。仓库的 snapshot JSONL driver 明确是测试内部设施，不是支持的 CLI 协议。因此 Companion 不解析 headless stdout 来重建轨迹，也不复制该测试驱动器。

## Companion 的旁路边界

下一 Session 建议在本仓库建立隔离的 `experiments/deepseek-harness/`，使用独立 package manifest、锁文件、profile 模板和输出目录。它不加入桌面应用的生产依赖，也不改变 `packages/agent-runtime` 的默认实现。

旁路由三部分组成：

1. **只读工具插件**：将 DSH 模型工具名 `market_query` 映射到逻辑工具名 `market.query`，调用现有 `@warframe-companion/market-query-service`，并原样返回 `MarketQueryResult` 的规范 JSON。插件不读取个人快照，不提供交易、聊天或账号写操作。
2. **评估策略插件**：从 runner 闭包取得 `AgentEvalCase.context`，用 `tools/pre-execute` 和最终 guard 执行身份/只读门禁。权限负例可挂载只会拒绝的合成工具 schema，以测量模型是否尝试越权；这些工具不得连接真实实现。
3. **评估驱动器**：通过正式 Agent/Session API 创建一轮任务，监听 `session/event` 与 `tools/result`，并要求模型通过受 schema 约束的终态工具提交 `decision`、`facts` 和可选 `refusalReason`。驱动器从事件权威地派生 `toolCalls` 和 `latencyMs`，校验模型提交与实际工具结果一致，再输出既有 `AgentTrace`。

终态工具只承载模型自己的结构化判断；模型不能自行填报调用次数、耗时、可信身份或工具真实结果。工具成功后调用 `concludeTurn()`。这样 30 条用例仍由同一个 `evaluateAgentTraces()` 评分，不需要从自然语言中猜测 decision 或事实。

```text
AgentEvalCase + 合成 Market fixture
                │
                ▼
Companion DSH eval driver ──可信 context──> policy plugin
                │
                ├── user prompt ───────────> DSH Agent + DeepSeek provider
                │                                  │
                │                                  ├── market_query
                │                                  └── submit_agent_trace
                │
session/event + tools/result
                │
                ▼
AgentTrace ──> 现有确定性 runner ──> JSON/Markdown 对比报告
```

## 可比性与报告规则

- 固定使用现有 30 条 `FIRST_AGENT_EVAL_CASES`，不得为 DSH 单独改 prompt、expected 或延迟预算。若协议不适配，应报告真实失败或先做版本化评估集。
- Market 响应继续使用合成/脱敏 fixture；真实模型评估不等于真实网络评估。真实网络行情烟测是另一条只读验证，不混入 30 条基线。
- 报告同时列出 `reference-contract-oracle`、`desktop-deterministic-harness` 与固定 DSH/模型候选；不得把 oracle 100% 当作模型成绩。
- 模型身份至少包含 DSH commit、DSH package version、provider、model id、base URL 类别、评估集版本和运行时间。报告不得包含 API Key、请求头、原始供应商响应或本机日志。
- `latencyMs` 只比较同一台机器上完整 case 的墙钟耗时；需要分别标出模型/工具是否为真实网络。不能与现有合成桌面延迟直接下性能结论。
- 每条 case 保留结构化 trace 和评分结果；模型最终自然语言可保存为脱敏的辅助字段，但不替代结构化事实与证据校验。

## 凭据与运行隔离

真实模型运行只允许 DSH 官方 credentials/env provider 在进程内读取既有 `DEEPSEEK_API_KEY` 或显式配置的凭据引用；Companion 代码、fixture、报告、命令输出和记忆文件均不得复制或记录凭据。本轮只做了凭据存在性布尔检查，没有回显值；生成的报告与轨迹也不包含凭据。

使用专用临时 `DSH_HOME` 或仓库忽略的实验状态目录，避免污染用户的普通 DSH profile。每个 case 使用全新 session；禁用 shell、文件写入、subagent、workflow、skills、网络搜索和自修改插件，只挂载模型、会话、Agent、Market 合成工具、门禁和轨迹导出所需的最小树。

## 许可证边界

DSH 根仓库和 222 个 DSH 包声明 MIT，完整第三方声明位于上游 `THIRD_PARTY_NOTICES.md`。当前只是同级独立克隆与构建，没有复制 DSH 源码进 Companion，因此 Companion 的 MIT 文件无需因本轮加入上游版权头。

若下一 Session 复制、修改或分发 DSH 的实质源码，必须保留 DeepSeek 的 MIT 版权与许可文本，并重新生成/核对第三方声明。优先采用外置插件和公开包依赖，避免 vendoring；实验 lockfile 必须记录具体 tarball integrity。

## Session 9 实现状态与真实模型结果

隔离实现位于 `experiments/deepseek-harness/`，拥有独立 manifest/lockfile、合成 Market fixture、外置工具/策略、终态结构化提交、事件适配器、keyless 测试、真实 DSH 组合预检和对比报告生成器。`reports/comparison.*` 当前状态为 `completed`，并保留逐 case 结构化轨迹。

完成情况：

1. keyless 单元测试证明 Market 映射、门禁、事件到 `AgentTrace` 的转换以及敏感信息扫描。
2. 使用原 30 条用例运行一次固定 DSH/DeepSeek 候选，生成逐 case trace 与 JSON/Markdown 报告。
3. 仓库根 `npm test` 继续通过，实验目录自己的锁文件、测试和构建通过。
4. 报告清楚区分真实模型、合成 Market、真实墙钟延迟和未验证项。
5. 不修改桌面 `agent-runtime`、OpenClaw、WFInfo、个人数据或任何外部渠道。

固定候选为 DSH `0.1.0-rc.5` / commit `47f943859bef60e4160492346772ded9b24f765a`、`deepseek-official/deepseek-v4-flash`。首轮结果为 **0/30、20.22%**：工具选择 30.00%，参数落地 9.09%，事实正确 20.00%，证据合规 0%，权限安全 66.67%，效率 10.00%。完整运行约 123 秒，逐 case 墙钟延迟约 1.2–11.8 秒。

该运行不是空跑：驱动器观察完整 Agent 生命周期，工具调用来自持久事件，终态来自 schema 约束提交。但这份分数只保留为 DSH 集成冒烟证据，不能作为 DSH/OpenClaw、模型或 Companion Harness 的横向结论。运行使用单一 `deepseek-v4-flash`、`thinking:disabled`、`reasoningEffort:off`、2048 token、极简工具与早期事实转录协议；没有实际 OpenClaw 模型基线，部分 prompt/expected 还有隐藏默认参数矛盾。名称规范化也尚无语义契约。

## Session 10：Agent eval v2 离线重评

v1 runner 和 Session 9 产物保持原样，历史基线仍是 **0/30、20.22%**。v2 使用独立 schema `2.0`、suite `warframe-companion-agent-eval-v2`、runner 和 `packages/agent-eval/reports/v2/` 输出目录，不覆盖历史文件。

v2 修正三处系统性偏差：期望工具真实调用后允许 `answer` 或 `call_tool` 作为终态；事实维度只检查必需事实和禁止事实，合理额外事实另由工具 fixture 支撑门禁验证；远程模型使用独立 15 秒完整 case 延迟预算，本地 Harness 继续沿用原逐 case 预算。必需证据、禁止事实、无支撑事实与权限拒绝原因优先级未放宽。参数仍是逐字比较，审核现把 `古纪V3 → Axi V3 Relic`、`赋能充沛 → Energize` 标为待契约确认的名称规范化候选，与 rank/platform/crossplay 等语义漂移分开。

离线命令只读取 Session 9 已保存的 `experiments/deepseek-harness/reports/traces.json` 和桌面既有 trace，没有读取凭据、发起模型请求或访问 Market。结果：

| 候选 | v1 | v2 | 延迟类别 |
|---|---:|---:|---|
| DSH / DeepSeek | 0/30，20.22% | 5/30，53.72% | `remote_model`，median 3324ms，p95 9732ms |
| 桌面确定性 Harness | 29/30，97.50% | 29/30，97.78% | `local_harness`，median 2ms，p95 2ms |

离线审核仍发现期望工具未调用、真实参数语义漂移、工具结果不支持的额外事实、必需证据缺失/改写，以及权限拒绝原因优先级错误。v2 的提升只说明 v1 尺子存在系统性偏差；这套历史结果不再服务于 backend 选型，也不继续围绕分数调提示词。详见 [`../packages/agent-eval/reports/v2/v1-v2-comparison.md`](../packages/agent-eval/reports/v2/v1-v2-comparison.md)。
