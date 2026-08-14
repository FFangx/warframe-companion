# 首批 Agent eval

这个包提供 38 条合成、脱敏用例和不依赖 LLM 评分器的确定性 runner。评估轨迹协议与具体 Agent Harness 解耦，后续 OpenClaw、桌面 Agent 和 DeepSeek 旁路适配器都可输出同一 `AgentTrace` 再使用相同规则评分。

## 覆盖范围

- 10 条工具路由与显式参数用例。
- 8 条状态事实、范围、时间、新鲜度和来源用例。
- 6 条错误分类与可解释降级用例。
- 6 条可信身份、个人数据与禁止写操作用例。
- 8 条独立 `drops.search` 用例：3 条中英文/别名路由、3 条缓存与源年龄及替代源证据、2 条过龄/无源降级。

报告包含工具选择、参数落地、事实正确、证据合规、权限安全和效率六类指标。空结果与数据源故障必须分开；过期快照不能证明当前状态；权限用例要求拒绝且零工具调用。

## 运行

```powershell
npm run eval --workspace @warframe-companion/agent-eval
```

命令会可重复生成 `reports/baseline.json` 与 `reports/baseline.md`；已提交报告使用固定基线时间，避免只因运行时钟产生无意义 diff。当前候选 `reference-contract-oracle` 是评估器的确定性上界自检，不是模型，也不代表 OpenClaw、DeepSeek 或任何真实 Harness 的成绩。真实 Agent 基线要等对应适配器能够导出结构化轨迹后再记录。

同一命令还会生成 `desktop-harness-traces.json`、`desktop-harness-baseline.json` 与 `desktop-harness-baseline.md`。这些文件来自桌面生产 `agent-runtime` 的真实编排路径，工具响应仍为合成夹具。新加入的掉落用例也走真实 `drops.search` 编排分支。首份基线保留真实失败，不把缺失参数静默补成桌面默认值；它是确定性 Harness 成绩，不是 LLM 成绩。

全部 prompt、时间、身份和事实均为合成值；不得用真实聊天、QQ/账号标识、原始个人快照、令牌或本机日志替换。

## DeepSeek Harness 旁路候选

`experiments/deepseek-harness` 已实现隔离工具、可信上下文门禁、终态结构化提交和正式事件到本包 `AgentTrace` 的适配器。首轮真实调用只证明 DSH 工具/guard/事件/终态链路可运行；0/30、20.22% 不用于比较 DSH、OpenClaw 或 Companion Harness，也不用于模型选型。原因包括单一模型/配置、没有 OpenClaw 对照、隐藏默认参数冲突、名称规范化契约缺失及不成熟的事实转录协议。具体边界见 [`docs/DEEPSEEK_HARNESS_BASELINE.md`](../../docs/DEEPSEEK_HARNESS_BASELINE.md)。

## v2 离线协议

实验目录中的 0/30、20.22% 报告保持不变。v2 是独立的 `2.0` 历史离线协议，仍固定重评原 30 条 Market trace；新增 8 条掉落用例未运行付费模型，不会被伪装成缺失的模型输出：

- 已真实完成期望工具调用后，终态 `answer` 与 `call_tool` 都表示该轮已完成；工具名仍必须匹配。
- 事实维度改为“必需事实存在 + 禁止事实不出现”。合理额外事实不因未写入 expected 自动失败，但必须通过合成工具结果支撑门禁；无支撑事实仍令整条用例失败。
- 本地确定性 Harness 沿用原逐 case 预算；远程模型使用独立的 15 秒完整 case 预算，并分别报告 min、median、p95 和 max。
- 参数当前仍逐字比较；离线审核把名称规范化候选与 rank/platform/crossplay 等真实语义漂移分开。该指标在引入规范化语义契约前不作为模型质量或架构选型证据。
- 必需证据的对象/范围/时间/新鲜度/来源，以及权限拒绝优先级均未放宽。

只使用已经保存的 trace 离线重评：

```powershell
npm run eval:v2:offline --workspace @warframe-companion/agent-eval
```

该命令只读 `reports/desktop-harness-traces.json` 和 `experiments/deepseek-harness/reports/traces.json`，不读取凭据、不调用模型或 API。产物写入 `reports/v2/`，不会覆盖任何 v1 基线。当前同一批输出为 DeepSeek v2 **5/30、53.72%**，桌面 Harness v2 **29/30、97.78%**；这些数字只说明评分规则变化与历史 trace 形态，不是 backend 横评。
