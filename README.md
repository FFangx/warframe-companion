# Warframe Companion

一个 Windows 本地优先、只读、证据驱动的 Warframe 国际服个人助手。目标是把现有确定性查询、个人快照、订阅诊断和 Agent 能力交付为可安装桌面应用，同时保留 QQ/OpenClaw 作为远程渠道。

当前处于产品化基础设施阶段，尚未包含桌面壳或真实 Market 适配器。

## 仓库结构

```text
docs/                           产品、架构、作品集与 Session 约定
packages/market-query-contract  market.query 类型、错误、脱敏 mock 与契约测试
```

后续按经过验收的 Session 增加 `packages/market-adapter`、`packages/application-service`、`apps/desktop` 和 `packages/evals`，不提前铺设空实现。

## 开发验证

要求 Node.js 22 或更高版本：

```powershell
npm ci
npm test
```

## 安全边界

- 只读处理 Warframe、AlecaFrame 和市场数据，不自动操作游戏、交易、聊天或账号资产。
- 不提交 API Key、Market Token、QQ 标识、AlecaFrame 解密密钥、原始个人快照、真实聊天或本机日志。
- 状态性结论必须带匹配对象、范围、时间、新鲜度和来源的确定性证据。
- Mock、评估集、截图与演示数据必须合成或完成脱敏。

详细定义见 [产品文档](docs/PRODUCT.md) 与 [目标架构](docs/ARCHITECTURE.md)。

## 相关仓库边界

- `openclaw-warframe-assistant`：当前生产 QQ/OpenClaw 渠道适配与运行时 Skill。
- `WFInfo-CN-DPI-Fix`：WFInfo 独立程序及其游戏内奖励辅助能力。
- 本仓库：共享契约、应用服务、桌面应用和 Agent 评估体系。
