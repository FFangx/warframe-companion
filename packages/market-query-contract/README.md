# `market.query` 类型化契约

这是桌面端、QQ/OpenClaw 适配层和未来 Agent Harness 共用的市场查询边界。当前目录只定义协议，不调用 Warframe.Market，也不改变现有运行时。

## 关键语义

- 请求必须显式提供 `platform`、`crossplay` 和 `rank`；适配器不得偷偷继承 QQ 的 PC 默认值。
- `ok: true` 与 `ok: false` 是稳定判别字段。空订单是成功快照，使用 `confirmed_absent_in_scope`；数据源故障是失败结果，使用 `UPSTREAM_*` 错误码。
- `sellOrders` 与 `buyOrders` 分开且每条订单重复声明 `side`，避免排序或渲染时反向。
- 挂单与 `closed_trades_90_days` 成交统计明确分离，不把当前挂单描述成历史成交价；统计带上当前最低卖价相对 90 日中位的 `deviationPct` 作为对照（null 表示无卖单或中位为 0，不伪造）。`sampleSize`、`dailyVolume` 与 `median` 均为 90 日历史口径。
- 每条订单携带卖家 `reputation`（可为 null）与卖家账号 `locale`（可为 null）。`locale` 以 `zh` 开头时私聊用中文规范名与中文模板，其他/未知一律英文 — 这是主进程生成 `/w` 的判定依据；卖家身份与文本不进模型轨迹。
- 物品携带 `image`（仅允许 `https://warframe.market/static/assets/...` 的有界 URL，null 表示无可用图；占位图在上游映射层剔除）与 `description`（zh-Hans/英文，MOD/赋能词条效果由卡片按行派生）。
- 套装根物品可携带 `set`：`components` 每件含 `quantity` 与 `lowestSell`（null = 该件无报价），`componentsTotal` 只对已有报价的部件求和、`pricedCount`/`missingCount` 显式报告覆盖；全部无报价时 `componentsTotal` 必须为 null，绝不把缺失报价当 0。
- 错误按 `validation`、`resolution`、`upstream`、`internal` 分类；重试性由错误码固定，调用方不得自行猜测。
- 运行时校验拒绝未声明字段，尤其不会透传原始响应、异常栈、请求头、令牌或本机路径；数组（订单 ≤50、警告 ≤12、标签 ≤24、散件 ≤24）、图片 URL、locale、reputation 与 deviationPct 均有明确边界。

## 使用

```ts
import {
  assertMarketQueryRequest,
  assertMarketQueryResult,
  type MarketQueryRequest,
  type MarketQueryResult,
} from '@warframe-companion/market-query-contract';
```

从仓库根目录执行开发验证：

```powershell
npm ci
npm test --workspace @warframe-companion/market-query-contract
```

`src/mock-fixtures.ts` 只使用合成物品、固定合成时间和 `SyntheticTenno*` 玩家名，可用于公开测试与演示；不得用真实聊天、账号快照、Market Token、玩家标识或本机路径替换这些夹具。
