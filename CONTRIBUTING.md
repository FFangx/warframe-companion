# 贡献指南（Contributing）

感谢你愿意参与 Warframe Companion。项目由个人业余维护，没有 SLA；提交 PR 不代表维护者承诺合并或按期回复。

## 开始之前

- 阅读 [README.md](README.md)、[AGENTS.md](AGENTS.md)、[docs/PRODUCT.md](docs/PRODUCT.md) 和 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
- 遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。安全问题走 [SECURITY.md](SECURITY.md) 的私有渠道。
- 不引入市场写操作、自动交易/聊天、游戏自动化，或绕过可信身份门读取个人数据的能力。
- 不提交凭据、个人快照、真实玩家/聊天、账号标识、本机日志、绝对用户路径或来源不明的素材。

## 开发环境与验证

要求 Windows、Node.js 22+ 和仓库声明的 npm 版本。提交前从仓库根运行：

```powershell
npm ci
npm run check:repo
npm run build
npm test
npm run eval --workspace @warframe-companion/agent-eval
npm audit --omit=dev --audit-level=high
git diff --check
```

评估必须保持确定性、零付费模型、合成/脱敏数据。运行 eval 后，受管报告不应产生未审查漂移。

## 改动要求

- 一个 PR 处理一个可独立验收的切片；同时更新合同、测试和相关文档。
- 状态性结果必须区分对象、范围、证据时间、新鲜度、来源以及“无结果”和“来源失败”。
- 新依赖必须进入 lockfile，并说明为何不能使用已有依赖或 Node 内置能力。
- UI 变化需要实际启动或渲染验证；安装变化需要实际打包验证。
- 提交信息使用英文祈使句前缀，例如 `feat:`、`fix:`、`test:`、`docs:` 或 `build:`。

参与贡献即表示接受仓库的 MIT 许可证和行为准则。
