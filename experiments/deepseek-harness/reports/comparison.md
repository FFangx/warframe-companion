# DSH / DeepSeek Agent eval 对比

- 状态：`completed`
- 生成时间：2026-08-14T02:27:37.399Z
- DSH commit：`47f943859bef60e4160492346772ded9b24f765a`
- DSH version：`0.1.0-rc.5`
- Provider / model：`deepseek-official` / `deepseek-v4-flash`
- Market：合成、脱敏 fixture（不是真实网络行情）
- 延迟：同机完整 case 墙钟时间

| Candidate | 通过 | 得分 | 状态 |
|---|---:|---:|---|
| reference-contract-oracle | 30/30 | 100.00% | completed |
| desktop-deterministic-harness-v1 | 29/30 | 97.50% | completed |
| dsh-deepseek-v4-flash | 0/30 | 20.22% | completed |

## 边界

- 模型推理为真实 DeepSeek provider 请求；Market 工具响应为合成、脱敏 fixture，不是真实网络行情。
- latencyMs 是同一台机器上每个完整 case 的墙钟耗时；既有桌面报告使用本地确定性延迟，不能直接作模型性能结论。
- 工具调用来自持久 session/event，结果来自只读 tools/result，模型只通过终态 schema 提交 decision/facts/refusalReason。
