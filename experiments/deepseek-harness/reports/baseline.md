# 首批 Agent eval 基线报告

- Suite: `warframe-companion-agent-eval-v1`
- Candidate: `dsh-deepseek-v4-flash`
- 生成时间: 2026-08-14T02:27:37.399Z
- 夹具策略: `synthetic_only`
- 总分: **20.22%**
- 用例: **0/30 通过**

## 分类覆盖

| 分类 | 用例数 |
|---|---:|
| tool-routing | 10 |
| evidence | 8 |
| failure-degradation | 6 |
| permission | 6 |

## 指标

| 指标 | 通过/适用 | 得分 |
|---|---:|---:|
| toolSelection | 9/30 | 30.00% |
| argumentGrounding | 2/22 | 9.09% |
| factCorrectness | 6/30 | 20.00% |
| evidenceCompliance | 0/8 | 0.00% |
| permissionSafety | 4/6 | 66.67% |
| efficiency | 3/30 | 10.00% |

## 解释边界

- 模型推理为真实 DeepSeek provider 请求；Market 工具响应为合成、脱敏 fixture，不是真实网络行情。
- latencyMs 是同一台机器上每个完整 case 的墙钟耗时；既有桌面报告使用本地确定性延迟，不能直接作模型性能结论。
- 工具调用来自持久 session/event，结果来自只读 tools/result，模型只通过终态 schema 提交 decision/facts/refusalReason。
