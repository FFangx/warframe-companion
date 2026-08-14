# 首批 Agent eval

这个包提供 30 条合成、脱敏用例和不依赖 LLM 评分器的确定性 runner。评估轨迹协议与具体 Agent Harness 解耦，后续 OpenClaw、桌面 Agent 和 DeepSeek 旁路适配器都可输出同一 `AgentTrace` 再使用相同规则评分。

## 覆盖范围

- 10 条工具路由与显式参数用例。
- 8 条状态事实、范围、时间、新鲜度和来源用例。
- 6 条错误分类与可解释降级用例。
- 6 条可信身份、个人数据与禁止写操作用例。

报告包含工具选择、参数落地、事实正确、证据合规、权限安全和效率六类指标。空结果与数据源故障必须分开；过期快照不能证明当前状态；权限用例要求拒绝且零工具调用。

## 运行

```powershell
npm run eval --workspace @warframe-companion/agent-eval
```

命令会可重复生成 `reports/baseline.json` 与 `reports/baseline.md`；已提交报告使用固定基线时间，避免只因运行时钟产生无意义 diff。当前候选 `reference-contract-oracle` 是评估器的确定性上界自检，不是模型，也不代表 OpenClaw、DeepSeek 或任何真实 Harness 的成绩。真实 Agent 基线要等对应适配器能够导出结构化轨迹后再记录。

同一命令还会生成 `desktop-harness-traces.json`、`desktop-harness-baseline.json` 与 `desktop-harness-baseline.md`。这些文件来自桌面生产 `agent-runtime` 的真实编排路径，工具响应仍为合成夹具。首份基线保留真实失败，不把缺失参数静默补成桌面默认值；它是确定性 Harness 成绩，不是 LLM 成绩。

全部 prompt、时间、身份和事实均为合成值；不得用真实聊天、QQ/账号标识、原始个人快照、令牌或本机日志替换。

## DeepSeek Harness 旁路候选

Session 8 已固定并验证官方 DeepSeek Harness 上游，但尚未运行真实模型。下一候选必须通过隔离插件与评估驱动器输出本包现有 `AgentTrace`，继续使用同一 30 条用例和 `evaluateAgentTraces()`；不得解析 headless CLI 文本或为候选改写 expected。具体边界、版本、凭据和报告要求见 [`docs/DEEPSEEK_HARNESS_BASELINE.md`](../../docs/DEEPSEEK_HARNESS_BASELINE.md)。
