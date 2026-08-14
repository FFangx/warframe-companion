# Warframe.Market 查询服务

`@warframe-companion/market-query-service` 是 `market.query` 的首个真实只读适配器。它调用 Warframe.Market v2 目录、物品详情与 `/top` 当前订单接口，并把可选的 v1 90 天已成交统计映射到共享契约。

## 稳定行为

- 请求必须显式提供平台、跨平台交易开关和等级。
- 复用现有助手的名称规范化方向，支持中英文正式名、常用中文别名、`Prime/P`、套装和部件写法。
- 可升级物品默认由调用方传 `0`；`max` 使用详情中的真实 `maxRank`。
- `/top` 订单不信任上游顺序：卖单升序、买单降序，各取前 5 条。
- 订单快照成功但买卖单均为空时返回 `confirmed_absent_in_scope`；上游故障返回 `ok:false` 和 `unavailable` 证据。
- 90 天统计失败只产生 `STATISTICS_UNAVAILABLE`，不覆盖已经成功取得的当前订单快照。
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
