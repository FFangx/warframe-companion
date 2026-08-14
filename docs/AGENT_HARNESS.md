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
- Chat Completions adapter 注册 `market.query`、`drops.search` 和内部 `agent.clarify` JSON Schema；只接受一个已注册的结构化调用，运行时再次校验参数白名单。
- 声明 `streaming:true` 时解析 SSE 文本和增量工具参数；AbortSignal 直接传给 HTTP 请求。稳定错误进入 `model_error` 事件和 `AgentTrace`，不会被错误归类为空结果。
- 当前工具结果仍由 Harness 的确定性证据层组织最终回答；尚未实现把工具结果回送模型的多轮生成。真实模型只在用户主动保存 profile、健康检查并发送消息后调用。

## 下一入口

后续首选在同一契约上增加工具结果回送与可审计的多轮终态，再设计视觉模型和 fallback；不得让文本模型伪装成支持截图，也不得自动探测或迁移密钥。
