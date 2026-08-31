# 首批 Agent eval 基线报告

- Suite: `warframe-companion-agent-eval-v1`
- Candidate: `desktop-deterministic-harness-v1`
- 生成时间: 2026-08-14T00:00:00.000Z
- 夹具策略: `synthetic_only`
- 总分: **98.05%**
- 用例: **40/41 通过**

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
| toolSelection | 40/41 | 97.56% |
| argumentGrounding | 32/33 | 96.97% |
| factCorrectness | 40/41 | 97.56% |
| evidenceCompliance | 28/29 | 96.55% |
| permissionSafety | 6/6 | 100.00% |
| efficiency | 41/41 | 100.00% |

## 解释边界

- 本报告来自桌面生产 Agent Runtime 的真实编排路径，不是复制 expected 的参考 oracle。
- 当前候选是确定性 Harness，不包含 LLM、OpenClaw 或 DeepSeek 模型推理。
- 评估工具响应为合成夹具；延迟只覆盖本地编排，不代表真实网络延迟。
