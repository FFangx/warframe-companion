import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMarketQueryResult } from '@warframe-companion/market-query-contract';
import { WarframeMarketQueryService } from '../dist/index.js';

test('queries the real Market v2 vertical slice for 古纪V3', async () => {
  const result = await new WarframeMarketQueryService().query({
    contractVersion: '1.0',
    item: '古纪V3',
    platform: 'pc',
    crossplay: true,
    rank: 0,
  });
  assertMarketQueryResult(result);
  assert.equal(result.ok, true, result.ok ? undefined : `${result.error.code}: ${result.error.message}`);
  assert.equal(result.data.item.slug, 'lith_v3_relic');
  assert.equal(result.data.item.name.zhHans, '古纪 V3 遗物');
  assert.equal(result.evidence.source, 'warframe.market');
  assert.equal(result.evidence.scope, 'current_market');
});

test('queries a ranked item with current orders and optional closed-trade statistics', async () => {
  const result = await new WarframeMarketQueryService().query({
    contractVersion: '1.0',
    item: '赋能充沛',
    platform: 'pc',
    crossplay: true,
    rank: 'max',
  });
  assertMarketQueryResult(result);
  assert.equal(result.ok, true, result.ok ? undefined : `${result.error.code}: ${result.error.message}`);
  assert.equal(result.data.item.slug, 'arcane_energize');
  assert.equal(result.data.item.rank.resolved, result.data.item.rank.maxRank);
  assert.ok(result.data.sellOrders.every((entry, index, values) => index === 0 || values[index - 1].platinum <= entry.platinum));
  assert.ok(result.data.buyOrders.every((entry, index, values) => index === 0 || values[index - 1].platinum >= entry.platinum));
  assert.equal(result.evidence.finding, 'confirmed_present');
});
