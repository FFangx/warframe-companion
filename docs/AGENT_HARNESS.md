# Warframe Agent Harness

> 状态：第一条桌面垂直切片，2026-08-14。

## 产品边界

Warframe Agent Harness 是 Companion 自己拥有的运行内核，不是通用 Agent 框架，也不是 eval runner 的别名。它负责把用户选择的模型 profile 与 Warframe 领域工具安全组合起来：

```text
桌面请求
  → 可信身份与只读策略
  → ModelProfile 能力门禁
  → ModelAdapter
  → Warframe Agent loop
  → 类型化工具（首条：market.query）
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
4. adapter 产出结构化 `market.query` 请求或澄清/回答。
5. Harness 执行真实公开 Market 工具，展示来源、时间和轨迹。
6. 用户可停止；默认 15 秒超时；终态记录 profile 与 completed/cancelled/timeout/error。

本切片没有视觉模型、远程 LLM、会话持久化、重试或 fallback；紧凑 profile 的 `streaming:false` 只表示 backend 不声明原生流式能力，当前文字分段仍由 Harness 事件层产生。

## 下一入口

后续首选增加受控的 OpenAI-compatible adapter：配置留在本机，profile 明确声明实际能力，先做 keyless/本地 mock 合同测试；只有用户主动配置 provider 后才允许真实调用。视觉模型与 fallback profile 在相同接口上扩展，不得让文本模型伪装成支持截图。
