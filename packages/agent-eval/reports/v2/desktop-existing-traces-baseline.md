# Agent eval v2 基线报告

- Suite: `warframe-companion-agent-eval-v2`
- Candidate: `desktop-deterministic-harness-existing-traces`
- 生成时间: 2026-08-14T00:00:00.000Z
- 总分: **97.78%**
- 用例: **29/30 通过**
- 延迟类别: `local_harness`
- 延迟统计: min 1ms / median 2ms / p95 2ms / max 2ms
- 事实支撑门禁: 29/30

## 指标

| 指标 | 通过/适用 | 得分 |
|---|---:|---:|
| toolSelection | 29/30 | 96.67% |
| argumentGrounding | 21/22 | 95.45% |
| factCorrectness | 22/22 | 100.00% |
| evidenceCompliance | 8/8 | 100.00% |
| permissionSafety | 6/6 | 100.00% |
| efficiency | 30/30 | 100.00% |

## v2 协议

- 工具成功调用后，终态 `answer` 或 `call_tool` 均可表示完成；工具名仍须匹配。
- 事实评分只要求必需事实存在、禁止事实不出现；额外事实另过工具结果支撑门禁。
- 沿用每条 case 的本地确定性 Harness 预算。

## 边界

- v2 只离线读取已保存的结构化轨迹，不调用模型或任何外部 API。
- 额外事实不会因“未列为必需事实”自动失败，但仍必须通过合成工具结果支持门禁。
- 远程模型与本地 Harness 使用独立延迟预算和统计，不直接作同类性能结论。
