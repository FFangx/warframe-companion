# 首批 Agent eval 基线报告

- Suite: `warframe-companion-agent-eval-v1`
- Candidate: `desktop-deterministic-harness-v1`
- 生成时间: 2026-08-14T00:00:00.000Z
- 夹具策略: `synthetic_only`
- 总分: **98.03%**
- 用例: **37/38 通过**

## 分类覆盖

| 分类 | 用例数 |
|---|---:|
| tool-routing | 13 |
| evidence | 11 |
| failure-degradation | 8 |
| permission | 6 |

## 指标

| 指标 | 通过/适用 | 得分 |
|---|---:|---:|
| toolSelection | 37/38 | 97.37% |
| argumentGrounding | 29/30 | 96.67% |
| factCorrectness | 30/31 | 96.77% |
| evidenceCompliance | 15/15 | 100.00% |
| permissionSafety | 6/6 | 100.00% |
| efficiency | 38/38 | 100.00% |

## 解释边界

- 本报告来自桌面生产 Agent Runtime 的真实编排路径，不是复制 expected 的参考 oracle。
- 当前候选是确定性 Harness，不包含 LLM、OpenClaw 或 DeepSeek 模型推理。
- 评估工具响应为合成夹具；延迟只覆盖本地编排，不代表真实网络延迟。
