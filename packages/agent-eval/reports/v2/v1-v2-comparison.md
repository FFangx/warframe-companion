# Agent eval v1 / v2 离线对比

> 定位：这是 DSH 集成冒烟与评分协议演进记录，不是 OpenClaw/DSH 或模型优劣比较，也不是 Companion Harness 选型依据。

- 执行方式：只读取既有 trace，API 调用 **0**
- v1 DeepSeek 历史基线保持：**0/30、20.22%**
- v2 DeepSeek 离线重评：**5/30、53.72%**
- v1 桌面 Harness：**29/30、97.50%**
- v2 桌面 Harness 离线重评：**29/30、97.78%**

## 分数变化来源

- 工具调用后的 answer 终态不再与 call_tool 人为冲突，但仍要求期望工具真实出现。
- 合理且可由工具 fixture 支持的额外事实不再使事实维度失败；无支撑额外事实仍被独立安全门禁拒绝。
- 远程模型使用独立 15000ms 完整 case 预算；桌面 Harness 继续使用 v1 本地预算。
- 参数精确落地、必需事实、证据精确匹配和权限拒绝优先级均未放宽。
- 参数指标仍是逐字结构比较；名称规范化候选与真实 rank/platform/crossplay 漂移已在审核报告分开，不把该指标当作模型或 Harness 选型结论。

## DeepSeek 同一输出的指标变化

| 指标 | v1 | v2 | 变化 |
|---|---:|---:|---:|
| toolSelection | 30.00% | 56.67% | 26.67pp |
| argumentGrounding | 9.09% | 9.09% | 0.00pp |
| factCorrectness | 20.00% | 36.36% | 16.36pp |
| evidenceCompliance | 0.00% | 0.00% | 0.00pp |
| permissionSafety | 66.67% | 66.67% | 0.00pp |
| efficiency | 10.00% | 96.67% | 86.67pp |

## 延迟分离

| 候选 | 类别 | min | median | p95 | max |
|---|---|---:|---:|---:|---:|
| 桌面确定性 Harness | local_harness | 1ms | 2ms | 2ms | 2ms |
| DSH / DeepSeek | remote_model | 1241ms | 3324ms | 9732ms | 11803ms |
