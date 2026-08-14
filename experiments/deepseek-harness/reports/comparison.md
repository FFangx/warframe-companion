# DSH / DeepSeek Agent eval 对比

- 状态：`blocked_no_credential`
- 生成时间：2026-08-14T02:17:44.517Z
- DSH commit：`47f943859bef60e4160492346772ded9b24f765a`
- DSH version：`0.1.0-rc.5`
- Provider / model：`deepseek-official` / `deepseek-v4-flash`
- Market：合成、脱敏 fixture（不是真实网络行情）
- 延迟：同机完整 case 墙钟时间

| Candidate | 通过 | 得分 | 状态 |
|---|---:|---:|---|
| reference-contract-oracle | 30/30 | 100.00% | completed |
| desktop-deterministic-harness-v1 | 29/30 | 97.50% | completed |
| dsh-deepseek-v4-flash | — | — | blocked_no_credential |

## 边界

- 未发现 DEEPSEEK_API_KEY；本次没有发起模型请求，也没有生成或伪造模型轨迹。
- 插件、门禁和事件适配器可通过 keyless 测试验收；真实 30 条成绩需在凭据可用后运行相同命令。
- 参考 oracle 与桌面确定性 Harness 的既有成绩仅作横向位置说明。
