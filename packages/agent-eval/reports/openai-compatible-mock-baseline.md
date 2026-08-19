# 首批 Agent eval 基线报告

- Suite: `warframe-companion-agent-eval-v1`
- Candidate: `openai-compatible-keyless-contract-mock`
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

- 本报告使用本地合成 Chat Completions/SSE transport 验证 OpenAI-compatible adapter 与生产 Harness 的合同路径。
- 它不调用远程或付费模型，不衡量任何真实模型质量，也不读取凭据。
- 工具响应、身份、时间和事实全部为合成夹具；延迟只覆盖本地编排。
