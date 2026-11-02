# Warframe Companion 仓库规则

本仓库承载 Warframe Companion 的共享契约、应用服务、桌面应用和 Agent 评估体系。开始修改前：

1. 完整读取根目录 `CURRENT.md`（如存在），再阅读 `docs/PRODUCT.md`、`docs/ARCHITECTURE.md` 和与当前任务相关的包文档。
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

当前状态、提交/推送、验证结果和下一入口维护在仓库根目录 `CURRENT.md`；重要实现、事故与设计决策追加根目录 `MEMORY.md`，历史仅按关键词读取。
两份文件为本机私有交接文档，已由 `.gitignore` 排除提交；新克隆如不存在，依据可验证仓库事实建立，不把缺失当成阻塞。公开文档不得记录私有交接文件的本机绝对路径。
本项目不再向 OpenClaw 的跨项目长期记忆重复追加 Companion 记录。

不得在该记忆文件记录任何凭据、账号标识或原始个人数据。
