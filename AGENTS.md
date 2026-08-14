# Warframe Companion 仓库规则

本仓库承载 Warframe Companion 的共享契约、应用服务、桌面应用和 Agent 评估体系。开始修改前：

1. 阅读 `docs/PRODUCT.md`、`docs/ARCHITECTURE.md` 和与当前任务相关的包文档。
2. 按 `docs/SESSION_WORKFLOW.md` 声明本次范围、验收方式以及是否触及运行时或个人数据。
3. 开始前检查 `git status -sb`，不得重置、覆盖或遗漏用户已有改动。

## 硬性边界

- Warframe、AlecaFrame、WFInfo、市场和账号集成保持只读；不得操作游戏、交易、聊天或账号资产。
- 不得提交 API Key、Market Token、QQ/账号标识、AlecaFrame 解密密钥、原始个人快照、真实聊天或本机日志。
- Mock、测试、评估和演示数据必须是合成或已脱敏数据。
- 状态性结论必须携带对象、范围、时间、新鲜度和来源；空结果不得与数据源故障共用同一种表示。
- OpenClaw 生产运行时和 WFInfo 是独立仓库。未经明确授权，不从本仓库部署、重启或修改它们。
- 新增依赖必须进入 lockfile；完成修改后从仓库根运行 `npm test`，并执行与改动相关的额外验证。

## 长期记忆

重要实现、路径变更、提交、推送和部署状态同步到：

`private project memory outside this repository`

不得在该记忆文件记录任何凭据、账号标识或原始个人数据。
