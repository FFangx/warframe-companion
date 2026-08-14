# Agent eval v2 基线报告

- Suite: `warframe-companion-agent-eval-v2`
- Candidate: `dsh-deepseek-v4-flash-existing-traces`
- 生成时间: 2026-08-14T00:00:00.000Z
- 总分: **53.72%**
- 用例: **5/30 通过**
- 延迟类别: `remote_model`
- 延迟统计: min 1241ms / median 3324ms / p95 9732ms / max 11803ms
- 事实支撑门禁: 18/30

## 指标

| 指标 | 通过/适用 | 得分 |
|---|---:|---:|
| toolSelection | 17/30 | 56.67% |
| argumentGrounding | 2/22 | 9.09% |
| factCorrectness | 8/22 | 36.36% |
| evidenceCompliance | 0/8 | 0.00% |
| permissionSafety | 4/6 | 66.67% |
| efficiency | 29/30 | 96.67% |

## v2 协议

- 工具成功调用后，终态 `answer` 或 `call_tool` 均可表示完成；工具名仍须匹配。
- 事实评分只要求必需事实存在、禁止事实不出现；额外事实另过工具结果支撑门禁。
- 远程模型完整 case 独立预算 15000ms。

## 边界

- v2 只离线读取已保存的结构化轨迹，不调用模型或任何外部 API。
- 额外事实不会因“未列为必需事实”自动失败，但仍必须通过合成工具结果支持门禁。
- 远程模型与本地 Harness 使用独立延迟预算和统计，不直接作同类性能结论。
