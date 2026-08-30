# 开发依赖风险记录

> 审核日期：2026-08-30
> 最迟复核：2026-09-30，或首次公开 Windows 安装包准备之前（以较早者为准）

## 当前结论

- `npm audit --omit=dev --audit-level=high`：0 个生产依赖漏洞。
- 完整 `npm audit`：25 个开发依赖告警（3 low、21 high、1 critical）。
- 告警均位于 Electron Forge 7.11.2 的开发/打包依赖链，包括 `extract-zip`、`tar` 和 `tmp`；应用运行时依赖树不包含这些告警。
- 截至审核日，Electron Forge 最新稳定版仍为 7.11.2，`extract-zip` 最新版仍为 2.0.1。`npm audit fix --force` 建议降级 Forge 组件到 6.4.2，属于破坏性变化，且不能作为未经打包回归的安全修复直接采用。

## 临时处置

1. CI 对生产依赖执行阻断式 audit；任何 high/critical 生产漏洞使检查失败。
2. Dependabot 每周检查根 workspace、隔离的 DeepSeek 实验和 GitHub Actions。
3. 当前公开范围只承诺源码与 CI，不发布或背书 Windows 安装包。
4. 首次预发布前必须重新检查上游版本，升级或替换受影响打包链，并实际执行 `make`、安装、启动、升级/卸载恢复验证。
5. 若复核日仍无兼容修复，只能在更新此记录、限定威胁模型并给出打包隔离证据后续期；不得静默忽略。
