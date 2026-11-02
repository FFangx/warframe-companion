# Warframe.Market 查询服务

`@warframe-companion/market-query-service` 是 `market.query` 的首个真实只读适配器。它调用 Warframe.Market v2 目录、物品详情与 `/top` 当前订单接口，并把可选的 v1 90 天已成交统计映射到共享契约。

## 稳定行为

- 请求必须显式提供平台、跨平台交易开关和等级。
- 复用现有助手的名称规范化方向，支持中英文正式名、常用中文别名、`Prime/P`、套装和部件写法。
- 可升级物品默认由调用方传 `0`；`max` 使用详情中的真实 `maxRank`。
- `/top` 订单不信任上游顺序：卖单升序、买单降序，各取前 5 条。
- 订单快照成功但买卖单均为空时返回 `confirmed_absent_in_scope`；上游故障返回 `ok:false` 和 `unavailable` 证据。
- 90 天统计失败只产生 `STATISTICS_UNAVAILABLE`，不覆盖已经成功取得的当前订单快照；统计带当前最低卖价相对 90 日中位的 `deviationPct`（null 表示无卖单或中位为 0）。
- 卖家 `reputation` 与账号 `locale` 映射进契约；超出契约边界或类型不符时按“未知”(null) 处理，不伪造数值或语言。`locale` 以 `zh` 开头时桌面主进程生成中文 `/w`，其他/未知生成英文。
- 传说赋能交易税按合成等级三角数换算（如 0 级 100,000 → 满级 2,100,000），其他物品用详情返回值。
- 物品图只映射为 `https://warframe.market/static/assets/...` 有界 URL，占位图（问号图与通用蓝图纸）视为无图；MOD/赋能词条文案取自详情 i18n 描述。
- 套装根物品从目录 id → 部件 slug 解析散件：每件独立拉详情+当前卖单（每批 3 件并发，单件失败只丢该件报价并计入缺件），`componentsTotal` 只对已有报价求和，全部无报价时为 null；整个散件环节失败只产生 `SET_COMPONENTS_UNAVAILABLE`，不覆盖有效的当前订单快照，也绝不伪造散件合计。
- 原始响应、异常、请求头和本机信息不会进入契约结果。

## 调用

```ts
import { WarframeMarketQueryService } from '@warframe-companion/market-query-service';

const market = new WarframeMarketQueryService();
const result = await market.query({
  contractVersion: '1.0',
  item: '古纪V3',
  platform: 'pc',
  crossplay: true,
  rank: 0,
});
```

HTTP 传输和时钟均可注入；单元测试只使用 `SyntheticTenno*` 合成身份。真实只读烟测需要显式执行：

```powershell
npm run test:live --workspace @warframe-companion/market-query-service
```

该包不缓存个人数据，不使用 Market Token，也不执行挂单、改单、删单、交易或聊天。
