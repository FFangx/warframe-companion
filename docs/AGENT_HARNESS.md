# Warframe Agent Harness

> 状态：本机模型配置与 OpenAI-compatible adapter 切片，2026-08-14。

## 产品边界

Warframe Agent Harness 是 Companion 自己拥有的运行内核，不是通用 Agent 框架，也不是 eval runner 的别名。它负责把用户选择的模型 profile 与 Warframe 领域工具安全组合起来：

```text
桌面请求
  → 可信身份与只读策略
  → ModelProfile 能力门禁
  → ModelAdapter
  → Warframe Agent loop
  → 类型化工具（当前：market.query、drops.search）
  → 证据约束回答、事件与 AgentTrace
```

稳定边界由 Companion 的 `ModelProfile`、`ModelAdapter`、工具契约和事件/轨迹协议定义；OpenClaw、DeepSeek Harness 或 OpenAI-compatible provider 都只能作为可替换 backend，不拥有产品契约。

## 最小接口

- `ModelProfile`：模型标识、adapter、用途描述和显式能力声明。
- `ModelCapabilities`：text、vision、native tools、structured output、reasoning、streaming、cancellation、context window。
- `ModelAdapter`：健康检查与单轮结构化决策；不能自行声明可信身份或绕过工具策略。
- capability routing：当前桌面市场 Agent 至少需要 text、native tools、structured output 与 cancellation；缺能力时明确标为不兼容。
- Harness：可信策略、超时/取消、工具执行、证据组织、流式事件和 `AgentTrace` 终态。

## 第一条切片

`packages/agent-runtime` 现内置第一个离线 backend `warframe-local-rules`，提供标准与紧凑两个可选 profile。它不读取密钥、不调用付费模型，目的不是模拟 LLM 质量，而是验证真实产品链路：

1. 桌面枚举并选择模型 profile。
2. 主进程执行能力与健康门禁。
3. Harness 先执行可信只读/权限策略，再调用 adapter。
4. adapter 产出结构化 `market.query` / `drops.search` 请求或澄清/回答。
5. Harness 执行真实公开只读工具；掉落证据额外区分缓存新鲜度、源数据年龄与替代源对照。
6. 用户可停止；默认 15 秒超时；终态记录 profile 与 completed/cancelled/timeout/error。

本切片没有视觉模型、会话持久化、自动重试或 fallback；紧凑 profile 的 `streaming:false` 只表示 backend 不声明原生流式能力，当前文字分段仍由 Harness 事件层产生。

## OpenAI-compatible 本机配置

- 配置契约只允许保存 profile 元数据、Base URL、模型名、显式能力、输出上限和凭据引用。凭据引用只能是 `none` 或大写环境变量名；内联 key、Authorization、密码字段和 URL 内凭据均被拒绝。
- 普通 HTTP 只允许 `localhost`、`127.0.0.1` 和 `::1`；其他地址必须使用 HTTPS。本机配置原子写入 Electron `userData/config/model-profiles.v1.json`，不使用 SQLite。
- 健康检查调用无生成费用的 `GET /models`，区分配置错误、凭据引用缺失、鉴权拒绝、限流、超时、不可用和坏响应。模型未出现在列表中会给兼容性提示，不伪装成已验证模型别名。
- Chat Completions adapter 注册 `market.query`、`drops.search`、内部 `agent.clarify` 与终态工具 `agent.conclude` JSON Schema；只接受一个已注册的结构化调用，运行时再次校验参数白名单。
- 声明 `streaming:true` 时解析 SSE 文本和增量工具参数；AbortSignal 直接传给 HTTP 请求。稳定错误进入 `model_error` 事件和 `AgentTrace`，不会被错误归类为空结果。

## 工具结果回送与可审计终态（Session 15 切片）

- `ModelAdapter` 通过可选 `supportsToolRoundTrip` 声明多轮能力；`generateTurn` 的 `history` 按 OpenAI 语义拼接 assistant `tool_calls` 与 `tool` 角色消息，工具结果只回送脱敏摘要，不回送原始订单、响应体或证据对象。
- Harness 在每次工具执行后把结果回送模型，模型可用文本 `answer` 或 `agent.conclude { text, conclusion }` 终态；`conclusion` 只有 `answered` 与 `insufficient_data`，且 `insufficient_data` 仅在上一次工具实际失败时被接受。模型不能提交事实、证据、身份、拒绝、延迟或调用次数；工具成功后的 `insufficient_data`、工具后的 `clarify` 与工具前的 `conclude` 都按协议滥用处理。
- 工具轮上限为 3；达到上限或第二轮模型故障（上游/协议类）时回落 Harness 确定性组织回答，并把稳定 `modelFailure` 记录进轨迹；取消与超时始终终止本轮，不回落。
- `AgentTrace` 新增 `conclusion`/`conclusionSource`（`model` 或 `harness`）与可选 `modelFailure`；`decision` 在工具轮后仍为 `call_tool`，不破坏既有 eval 口径。事件流新增 `model_conclusion`。
- 离线 `warframe-local-rules` 后端不声明回送，继续由 Harness 确定性组织回答；桌面 UI 在工具轨迹中显示终态来源。
- 事实投影无条件化：Harness 对工具结果始终派生同一组规范 facts 并写入 `AgentTrace`（市场成功：卖/买单存在性、快照范围、当前挂单口径、90 天历史口径、统计可用性；失败：availability/error.code/retryable 等），生产与评估同构。已删除 `evaluation.factMode` 投影开关；显式默认市场参数改为请求级 `AgentRunRequest.defaults`，评估驱动器只在请求层注入，不再改变 Agent 行为。
- adapter 接口版本化：`ModelAdapter.adapterVersion` 为必填，`generateTurn` 返回 `ModelTurnResult { turn, usage?, finishReason? }`；Harness 把 adapter 版本、多轮累计 token 用量与最后结束原因记入 `AgentTrace`，为视觉/fallback 等能力扩展保留演化空间，也提供作品集可观测性素材。
- 真实远程模型冒烟：`npm run smoke:live --workspace @warframe-companion/agent-runtime` 使用真实 DeepSeek（OpenAI-compatible）与真实 Market/掉落工具验证「工具调用 → 回送 → 终态」链路；运行前由用户自行设置 `DEEPSEEK_API_KEY` 环境变量，脚本不打印、不记录 key。2026-08-19 首次真实模型验收通过（3/3，DeepSeek v4-flash：market 回送、drops 回送、缺参澄清均完成，第二轮由模型提交 `agent.conclude[answered]`），并实测出两条 provider 兼容性约束：
  - 线上工具名必须匹配 `^[a-zA-Z0-9_-]+$`（DeepSeek 拒绝带点号工具名），adapter 在 wire 层映射 `market.query→market_query` 等，内部逻辑名不变。
  - DeepSeek 思考模式要求把上一轮响应的 `reasoning_content` 原样回传，否则第二轮返回 400；adapter 捕获思维链并随工具轮回送（`ToolRoundStep.assistantReasoning`），Harness 只作不透明回传，不进 `AgentTrace`、不展示、不参与评估。
  - 健康检查默认 5 秒超时对真实 API 偶发不足，冒烟脚本使用 10 秒。

## 下一入口

后续首选设计视觉模型与 fallback：先定义视觉输入的观察协议，再实现回退 profile 与健康路由；不得让文本模型伪装成支持截图，也不得自动探测或迁移密钥。真实远程模型仍只在用户主动保存 profile、健康检查并发送消息后调用。
