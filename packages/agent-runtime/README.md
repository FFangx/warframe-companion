# 桌面 Agent Runtime

Companion 自有 Warframe Agent Harness 的第一条模型可配置切片。它定义 `ModelProfile`、`ModelAdapter` 与能力/健康门禁，由 Harness 统一执行可信策略、公开只读 `market.query` / `drops.search`、取消/超时、流式事件和 `AgentTrace`。掉落回答分别保留缓存新鲜度、源数据年龄、替代源对照与过龄门禁事实。

当前 backend 包括完全离线、零密钥的 `warframe-local-rules`，以及受控 `openai-compatible` adapter。后者的本机配置只保存凭据引用，支持 `/models` 健康检查、Chat Completions 结构化工具、SSE、取消与稳定错误分类；合同测试只使用本地合成 transport。

工具结果回送：adapter 可用 `supportsToolRoundTrip` 声明多轮能力。声明后 Harness 在每次工具执行后把脱敏结果摘要回送模型，模型可用文本回答或内部 `agent.conclude` 提交 `answered` / `insufficient_data` 终态；事实、证据、身份、拒绝、延迟与调用次数永远由 Harness 决定。普通任务提前 `answer`/`conclude` 后直接提交，不附加固定“反思”。轨迹含 `conclusion` / `conclusionSource`、稳定 `modelFailure`、`toolAttempts` / `modelRequests` 计数与 `finalizedBy`（受限汇总来源）。

## 循环预算与停止（D2a1）

- `RunPolicy`（`src/run-policy.ts`）由主进程构造：`maxToolAttempts=15`、`maxModelRequests=24`（最后 1 次预留给 finalize）、`hardDeadlineMs=120_000`、`finalizeReserveMs=20_000`、`modelRequestTimeoutMs=30_000`、`finalizeRequestTimeoutMs=20_000`、`healthTimeoutMs=10_000`、`toolTimeoutMs=15_000`、`totalTokenBudget=80_000`。这些都是待验证的项目初始配置，不是行业默认值。
- renderer 不再固定传 15 秒：桌面默认使用主进程 `DEFAULT_RUN_POLICY`（120 秒）；显式 `timeoutMs` 只能缩短硬截止时间，不能提高预算。
- 记录第 15 个 Observation 后进入一次性受限最终汇总（finalize）：`generateTurn(mode: 'finalize')` 的请求不暴露任何业务或控制工具，Harness 执行门禁同时拒绝任何业务调用（绝不执行第 16 次）。finalizer 再请求工具、输出非法、模型失败或剩余时间不足时只做一次确定性程序收束，不修复、不重试。
- 用户取消或硬超时后不再发起任何模型请求；健康检查、模型请求与领域工具贯穿同一运行 `AbortSignal`（`checkModelProfile` 支持 `signal`/`timeoutMs`；`deps.marketQuery/searchDrops/getSnapshot` 收到第二参 signal；market-query-service 与 warframe-data-service 的 `query`/`searchDrops` 合并该信号与自身超时）。无法真正中止的迟到结果由竞速隔离，不能覆盖终态；一次运行最多提交一个终态（事件通道故障也不会产生第二个 `completed`）。
- `ModelAdapter.adapterVersion` 已升到 2（执行模式扩展）：本地规则与 OpenAI-compatible 后端同步升级。

默认范围与等级由 Harness 模型无关地保证：未保存默认范围且自然市场问价缺平台/跨平台时，选择卡在调用模型之前稳定发出（返回普通文本的 OpenAI-compatible adapter 无法绕过；掉落、个人、寒暄、写操作拒绝与明确完整范围不触发）；任何 adapter 产生的 `market.query` 在工具执行前按“本条消息明确条件 → `defaults` → 缺省 0 级”程序归一化，模型给错范围不能覆盖用户条件或已保存偏好，消息临时范围不写回偏好。卡片选择后由主进程保存偏好并重跑原消息。

后续 Planning、Memory、Tool Use、Action 和 Agent Loop 的设计见 [运行架构设计](../../docs/AGENT_RUNTIME_DESIGN.md)。v2 控制协议（`agent.finish` / EvidenceLedger / 需求覆盖 / 分类 stopReason / 会话状态）与评估打分属于 D2a2、D2b、D2c，尚未实现；本切片不宣称已完成真实远程模型验收。
