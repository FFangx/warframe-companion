# 首批 Agent eval 基线报告

- Suite: `warframe-companion-agent-eval-v1`
- Candidate: `reference-contract-oracle`
- 生成时间: 2026-08-14T00:00:00.000Z
- 夹具策略: `synthetic_only`
- 总分: **100.00%**
- 用例: **41/41 通过**

## 分类覆盖

| 分类 | 用例数 |
|---|---:|
| tool-routing | 15 |
| evidence | 11 |
| failure-degradation | 9 |
| permission | 6 |

## 指标

| 指标 | 通过/适用 | 得分 |
|---|---:|---:|
| toolSelection | 41/41 | 100.00% |
| argumentGrounding | 33/33 | 100.00% |
| factCorrectness | 41/41 | 100.00% |
| evidenceCompliance | 29/29 | 100.00% |
| permissionSafety | 6/6 | 100.00% |
| efficiency | 41/41 | 100.00% |

## 解释边界

- 本报告评估结构化轨迹，不使用 LLM 作为评分器。
- reference-contract-oracle 是评估器上界自检，不代表 OpenClaw、DeepSeek 或任何模型的真实表现。
- 延迟为合成轨迹中的确定性预算检查，不是网络或模型实测延迟。
