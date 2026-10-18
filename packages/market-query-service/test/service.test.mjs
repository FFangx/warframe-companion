import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMarketQueryResult } from '@warframe-companion/market-query-contract';
import { WarframeMarketQueryService, resolveMarketItem } from '../dist/index.js';

const NOW = new Date('2030-01-02T03:04:05.000Z');
const REQUEST = {
  contractVersion: '1.0',
  item: '示例赋能',
  platform: 'pc',
  crossplay: true,
  rank: 'max',
};

const CATALOG = {
  data: [{
    id: 'synthetic-item-id',
    slug: 'example_arcane',
    tags: ['arcane_enhancement', 'legendary'],
    i18n: {
      en: { name: 'Example Arcane' },
      'zh-hans': { name: '示例赋能' },
    },
  }],
};

const DETAIL = {
  data: {
    slug: 'example_arcane',
    tags: ['arcane_enhancement', 'legendary'],
    maxRank: 5,
    ducats: null,
    tradingTax: 2_100_000,
    reqMasteryRank: 8,
    i18n: {
      en: { name: 'Example Arcane' },
      'zh-hans': { name: '示例赋能' },
    },
  },
};

function order(side, platinum, name, updatedAt, extra = {}) {
  return {
    id: `synthetic-${side}-${platinum}`,
    type: side,
    platinum,
    quantity: 1,
    rank: 5,
    visible: true,
    updatedAt,
    user: {
      ingameName: name,
      platform: 'pc',
      crossplay: true,
      status: 'ingame',
    },
    ...extra,
  };
}

const ORDERS = {
  data: {
    sell: [
      order('sell', 14, 'SyntheticTennoB', '2030-01-02T03:03:02Z'),
      order('sell', 10, 'SyntheticTennoA', '2030-01-02T03:03:01Z'),
      order('sell', 1, 'SyntheticHidden', '2030-01-02T03:03:00Z', { visible: false }),
    ],
    buy: [
      order('buy', 8, 'SyntheticTennoC', '2030-01-02T03:02:01Z'),
      order('buy', 9, 'SyntheticTennoD', '2030-01-02T03:02:02Z'),
    ],
  },
};

const STATISTICS = {
  payload: {
    statistics_closed: {
      '90days': [
        { datetime: '2030-01-01T00:00:00+00:00', median: 12, volume: 2, mod_rank: 5 },
        { datetime: '2029-12-31T00:00:00+00:00', median: 10, volume: 3, mod_rank: 5 },
        { datetime: '2029-12-30T00:00:00+00:00', median: 11, volume: 4, mod_rank: 5 },
        { datetime: '2029-12-30T00:00:00+00:00', median: 999, volume: 99, mod_rank: 0 },
      ],
    },
  },
};

function jsonResponse(value, init) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function routedFetch(overrides = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (overrides[url]) return overrides[url](url, init);
    if (url.endsWith('/v2/items')) return jsonResponse(CATALOG);
    if (url.endsWith('/v2/item/example_arcane')) return jsonResponse(DETAIL);
    if (url.endsWith('/v2/orders/item/example_arcane/top?rank=5')) return jsonResponse(ORDERS);
    if (url.endsWith('/v1/items/example_arcane/statistics')) return jsonResponse(STATISTICS);
    throw new Error(`unexpected synthetic URL: ${url}`);
  };
  return { fetch, calls };
}

test('maps live API shapes to the typed contract and sorts /top orders explicitly', async () => {
  const transport = routedFetch();
  const service = new WarframeMarketQueryService({ fetch: transport.fetch, now: () => NOW });
  const result = await service.query(REQUEST);

  assertMarketQueryResult(result);
  assert.equal(result.ok, true);
  assert.equal(result.data.item.slug, 'example_arcane');
  assert.deepEqual(result.data.item.rank, { requested: 'max', resolved: 5, maxRank: 5 });
  assert.equal(result.data.item.tradingTax, 2_100_000);
  assert.deepEqual(result.data.sellOrders.map((entry) => entry.platinum), [10, 14]);
  assert.deepEqual(result.data.buyOrders.map((entry) => entry.platinum), [9, 8]);
  assert.equal(result.data.statistics.median, 11);
  assert.equal(result.data.statistics.dailyVolume, 3);
  assert.equal(result.data.statistics.sampleSize, 9);
  // Lowest sell (10) vs 90-day median (11): round((10-11)/11*100) = -9%.
  assert.equal(result.data.statistics.deviationPct, -9);
  assert.equal(result.data.statistics.asOf, '2030-01-01T00:00:00.000Z');
  assert.equal(result.data.item.image, null);
  assert.deepEqual(result.data.item.description, { en: null, zhHans: null });
  assert.equal(result.data.set, undefined);
  assert.equal(result.evidence.finding, 'confirmed_present');
  assert.equal(result.evidence.asOf, NOW.toISOString());
  assert.equal(result.evidence.expiresAt, '2030-01-02T03:09:05.000Z');
  assert.deepEqual(result.warnings, []);

  const requestHeaders = transport.calls[0].init.headers;
  assert.deepEqual(requestHeaders, {
    Accept: 'application/json', Platform: 'pc', Crossplay: 'true', Language: 'zh-hans',
  });
  assert.ok(transport.calls.some((call) => call.url.endsWith('/top?rank=5')));
});

test('treats empty orders as a successful absent-in-scope snapshot', async () => {
  const transport = routedFetch({
    'https://api.warframe.market/v2/orders/item/example_arcane/top?rank=5': () => jsonResponse({ data: { sell: [], buy: [] } }),
    'https://api.warframe.market/v1/items/example_arcane/statistics': () => jsonResponse({ payload: {} }),
  });
  const result = await new WarframeMarketQueryService({ fetch: transport.fetch, now: () => NOW }).query(REQUEST);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.finding, 'confirmed_absent_in_scope');
  assert.deepEqual(result.data.sellOrders, []);
  assert.deepEqual(result.data.buyOrders, []);
  assert.deepEqual(result.warnings.map((warning) => warning.code), [
    'NO_SELL_ORDERS', 'NO_BUY_ORDERS', 'STATISTICS_UNAVAILABLE',
  ]);
});

test('keeps statistics failure non-fatal when the order snapshot succeeds', async () => {
  const transport = routedFetch({
    'https://api.warframe.market/v1/items/example_arcane/statistics': () => new Response('', { status: 503 }),
  });
  const result = await new WarframeMarketQueryService({ fetch: transport.fetch, now: () => NOW }).query(REQUEST);
  assert.equal(result.ok, true);
  assert.equal(result.data.statistics, undefined);
  assert.deepEqual(result.warnings.map((warning) => warning.code), ['STATISTICS_UNAVAILABLE']);
});

test('resolves existing shorthand and reports not-found or ambiguous names without fetching details', async () => {
  const aliasCatalog = {
    data: [
      { slug: 'wukong_prime_set', tags: ['prime'], i18n: { en: { name: 'Wukong Prime Set' }, 'zh-hans': { name: '悟空 Prime 一套' } } },
      { slug: 'example_prime_set', tags: ['prime'], i18n: { en: { name: 'Example Prime Set' }, 'zh-hans': { name: '示例 Prime 一套' } } },
      { slug: 'example_prime_blueprint', tags: ['prime'], i18n: { en: { name: 'Example Prime Blueprint' }, 'zh-hans': { name: '示例 Prime 蓝图' } } },
    ],
  };
  const fetch = async (url) => {
    if (url.endsWith('/v2/items')) return jsonResponse(aliasCatalog);
    if (url.endsWith('/v2/item/wukong_prime_set')) return jsonResponse({
      data: { tags: ['prime'], tradingTax: 4000, i18n: { en: { name: 'Wukong Prime Set' }, 'zh-hans': { name: '悟空 Prime 一套' } } },
    });
    if (url.endsWith('/v2/orders/item/wukong_prime_set/top')) return jsonResponse({ data: { sell: [], buy: [] } });
    if (url.endsWith('/v1/items/wukong_prime_set/statistics')) return jsonResponse({ payload: {} });
    throw new Error(`unexpected URL ${url}`);
  };
  const service = new WarframeMarketQueryService({ fetch, now: () => NOW });
  const base = { ...REQUEST, rank: 0 };
  const alias = await service.query({ ...base, item: '悟空p' });
  assert.equal(alias.ok, true);
  assert.equal(alias.data.item.slug, 'wukong_prime_set');

  const ambiguous = await service.query({ ...base, item: '示例' });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error.code, 'ITEM_AMBIGUOUS');
  assert.deepEqual(ambiguous.error.details.candidates.map((item) => item.slug), [
    'example_prime_set', 'example_prime_blueprint',
  ]);

  const missing = await service.query({ ...base, item: '完全不存在的合成物品' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'ITEM_NOT_FOUND');
});

test('retries category-prefixed arcane aliases only after the original name has no match', () => {
  const resolved = resolveMarketItem([{
    slug: 'arcane_energize',
    name: { en: 'Arcane Energize', zhHans: '赋能·充沛' },
    tags: ['arcane_enhancement', 'legendary'],
  }], '赋能充沛');
  assert.equal(resolved.match.slug, 'arcane_energize');
});

test('rejects invalid requests and out-of-range ranks with stable validation codes', async () => {
  let calls = 0;
  const service = new WarframeMarketQueryService({
    fetch: async () => { calls += 1; throw new Error('must not fetch'); },
  });
  const unsupported = await service.query({ ...REQUEST, platform: 'dreamcast' });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, 'UNSUPPORTED_PLATFORM');
  const invalid = await service.query({ ...REQUEST, rank: -1 });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_RANK');
  assert.equal(calls, 0);

  const transport = routedFetch();
  const tooHigh = await new WarframeMarketQueryService({ fetch: transport.fetch }).query({ ...REQUEST, rank: 6 });
  assert.equal(tooHigh.ok, false);
  assert.equal(tooHigh.error.code, 'INVALID_RANK');
  assert.equal(transport.calls.some((call) => call.url.includes('/orders/')), false);
});

test('classifies timeout, rate limit, unavailable, and bad JSON without leaking raw failures', async (t) => {
  const cases = [
    {
      name: 'timeout',
      expected: 'UPSTREAM_TIMEOUT',
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('synthetic secret', 'AbortError')));
      }),
      options: { timeoutMs: 5 },
    },
    {
      name: 'rate limit',
      expected: 'UPSTREAM_RATE_LIMITED',
      fetch: async () => new Response('', { status: 429, headers: { 'Retry-After': '30' } }),
      retryAfterMs: 30_000,
    },
    {
      name: 'unavailable',
      expected: 'UPSTREAM_UNAVAILABLE',
      fetch: async () => new Response('', { status: 503 }),
    },
    {
      name: 'bad JSON',
      expected: 'UPSTREAM_BAD_RESPONSE',
      fetch: async () => new Response('not-json', { status: 200 }),
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const result = await new WarframeMarketQueryService({
        fetch: entry.fetch,
        now: () => NOW,
        ...entry.options,
      }).query(REQUEST);
      assertMarketQueryResult(result);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, entry.expected);
      assert.equal(result.evidence.finding, 'unavailable');
      if (entry.retryAfterMs) assert.equal(result.error.details.retryAfterMs, entry.retryAfterMs);
      assert.doesNotMatch(JSON.stringify(result), /synthetic secret|stack|cause|raw/iu);
    });
  }
});

test('rejects malformed order rows as a bad upstream response instead of silently dropping them', async () => {
  const malformed = structuredClone(ORDERS);
  delete malformed.data.sell[0].user.ingameName;
  const transport = routedFetch({
    'https://api.warframe.market/v2/orders/item/example_arcane/top?rank=5': () => jsonResponse(malformed),
  });
  const result = await new WarframeMarketQueryService({ fetch: transport.fetch, now: () => NOW }).query(REQUEST);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UPSTREAM_BAD_RESPONSE');
  assert.equal(result.evidence.finding, 'unavailable');
});

test('maps seller reputation and locale into the typed contract and keeps the /w language decision data', async () => {
  const localized = await new WarframeMarketQueryService({
    fetch: async (url) => {
      if (url.endsWith('/v2/items')) return jsonResponse(CATALOG);
      if (url.endsWith('/v2/item/example_arcane')) return jsonResponse(DETAIL);
      if (url.endsWith('/v2/orders/item/example_arcane/top?rank=5')) return jsonResponse({
        data: {
          sell: [order('sell', 10, 'SyntheticTennoZh', '2030-01-02T03:03:01Z', {
            user: {
              ingameName: 'SyntheticTennoZh', platform: 'pc', crossplay: true, status: 'ingame',
              reputation: 152, locale: 'zh-hans',
            },
          })],
          buy: [order('buy', 8, 'SyntheticTennoEn', '2030-01-02T03:02:01Z', {
            user: {
              ingameName: 'SyntheticTennoEn', platform: 'pc', crossplay: true, status: 'online',
              reputation: null, locale: 'de',
            },
          })],
        },
      });
      if (url.endsWith('/v1/items/example_arcane/statistics')) return jsonResponse(STATISTICS);
      throw new Error(`unexpected synthetic URL: ${url}`);
    },
    now: () => NOW,
  }).query(REQUEST);
  assert.equal(localized.ok, true);
  assert.equal(localized.data.sellOrders[0].reputation, 152);
  assert.equal(localized.data.sellOrders[0].locale, 'zh-hans');
  assert.equal(localized.data.buyOrders[0].reputation, null);
  assert.equal(localized.data.buyOrders[0].locale, 'de');
  // Out-of-contract values are treated as unknown, never fabricated.
  const sanitized = await new WarframeMarketQueryService({
    fetch: async (url) => {
      if (url.endsWith('/v2/items')) return jsonResponse(CATALOG);
      if (url.endsWith('/v2/item/example_arcane')) return jsonResponse(DETAIL);
      if (url.endsWith('/v2/orders/item/example_arcane/top?rank=5')) return jsonResponse({
        data: {
          sell: [order('sell', 10, 'SyntheticTennoWeird', '2030-01-02T03:03:01Z', {
            user: {
              ingameName: 'SyntheticTennoWeird', platform: 'pc', crossplay: true, status: 'ingame',
              reputation: 9_999_999, locale: 'zh_hans_bad',
            },
          })],
          buy: [],
        },
      });
      if (url.endsWith('/v1/items/example_arcane/statistics')) return jsonResponse(STATISTICS);
      throw new Error(`unexpected synthetic URL: ${url}`);
    },
    now: () => NOW,
  }).query(REQUEST);
  assert.equal(sanitized.ok, true);
  assert.equal(sanitized.data.sellOrders[0].reputation, null);
  assert.equal(sanitized.data.sellOrders[0].locale, null);
});

test('computes legendary arcane trading tax per synthesis rank (parity: 0级 100,000 / 5级 2,100,000)', async () => {
  const fetch = async (url) => {
    if (url.endsWith('/v2/items')) return jsonResponse(CATALOG);
    if (url.endsWith('/v2/item/example_arcane')) return jsonResponse(DETAIL);
    if (/\/v2\/orders\/item\/example_arcane\/top\?rank=\d+$/u.test(url)) return jsonResponse(ORDERS);
    if (url.endsWith('/v1/items/example_arcane/statistics')) return jsonResponse(STATISTICS);
    throw new Error(`unexpected synthetic URL: ${url}`);
  };
  const service = new WarframeMarketQueryService({ fetch, now: () => NOW });
  const max = await service.query(REQUEST);
  assert.equal(max.ok, true);
  assert.equal(max.data.item.tradingTax, 2_100_000);
  const base = await service.query({ ...REQUEST, rank: 0 });
  assert.equal(base.ok, true);
  assert.equal(base.data.item.tradingTax, 100_000);
});

test('parses safe market asset URLs, drops placeholders, and keeps description text', async () => {
  const detail = {
    data: {
      ...DETAIL.data,
      i18n: {
        en: {
          name: 'Example Arcane',
          icon: '/static/assets/example_icon.png',
          thumb: '/static/assets/example_thumb.png',
          subIcon: '/static/assets/example_sub.png',
        },
        'zh-hans': {
          name: '示例赋能',
          description: '+50 能量\n初始能量 +100',
        },
      },
    },
  };
  const result = await new WarframeMarketQueryService({
    fetch: async (url) => {
      if (url.endsWith('/v2/items')) return jsonResponse(CATALOG);
      if (url.endsWith('/v2/item/example_arcane')) return jsonResponse(detail);
      if (url.endsWith('/v2/orders/item/example_arcane/top?rank=5')) return jsonResponse({ data: { sell: [], buy: [] } });
      if (url.endsWith('/v1/items/example_arcane/statistics')) return jsonResponse({ payload: {} });
      throw new Error(`unexpected synthetic URL: ${url}`);
    },
    now: () => NOW,
  }).query(REQUEST);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.item.image, {
    icon: 'https://warframe.market/static/assets/example_icon.png',
    thumb: 'https://warframe.market/static/assets/example_thumb.png',
    subIcon: 'https://warframe.market/static/assets/example_sub.png',
  });
  assert.equal(result.data.item.description.zhHans, '+50 能量\n初始能量 +100');
  assert.equal(result.data.item.description.en, null);

  const placeholderDetail = {
    data: {
      ...DETAIL.data,
      i18n: {
        en: { name: 'Example Arcane', icon: '/static/assets/5c3a.fd671126fd4051e8e3addc13ae56d1f0.128x128.png', thumb: 'https://evil.example/static/assets/x.png', subIcon: 'blueprint_128x128.abc123.png' },
        'zh-hans': { name: '示例赋能' },
      },
    },
  };
  const degraded = await new WarframeMarketQueryService({
    fetch: async (url) => {
      if (url.endsWith('/v2/items')) return jsonResponse(CATALOG);
      if (url.endsWith('/v2/item/example_arcane')) return jsonResponse(placeholderDetail);
      if (url.endsWith('/v2/orders/item/example_arcane/top?rank=5')) return jsonResponse({ data: { sell: [], buy: [] } });
      if (url.endsWith('/v1/items/example_arcane/statistics')) return jsonResponse({ payload: {} });
      throw new Error(`unexpected synthetic URL: ${url}`);
    },
    now: () => NOW,
  }).query(REQUEST);
  assert.equal(degraded.ok, true);
  assert.equal(degraded.data.item.image, null);
  assert.deepEqual(degraded.data.item.description, { en: null, zhHans: null });
});

const SET_CATALOG = {
  data: [
    { id: 'catalog-set-1', slug: 'example_prime_set', tags: ['prime', 'set'], i18n: { en: { name: 'Example Prime Set' }, 'zh-hans': { name: '示例 Prime 一套' } } },
    { id: 'part-a', slug: 'example_prime_neuroptics', tags: ['prime'], i18n: { en: { name: 'Example Prime Neuroptics' }, 'zh-hans': { name: '示例 Prime 头部神经光元' } } },
    { id: 'part-b', slug: 'example_prime_chassis', tags: ['prime'], i18n: { en: { name: 'Example Prime Chassis' }, 'zh-hans': { name: '示例 Prime 机体' } } },
    { id: 'part-c', slug: 'example_prime_systems', tags: ['prime'], i18n: { en: { name: 'Example Prime Systems' }, 'zh-hans': { name: '示例 Prime 系统' } } },
    { id: 'part-d', slug: 'example_prime_blueprint', tags: ['prime'], i18n: { en: { name: 'Example Prime Blueprint' }, 'zh-hans': { name: '示例 Prime 蓝图' } } },
  ],
};

const SET_DETAIL = {
  data: {
    id: 'catalog-set-1',
    slug: 'example_prime_set',
    tags: ['prime', 'set'],
    setRoot: true,
    setParts: ['catalog-set-1', 'part-a', 'part-b', 'part-c', 'part-d'],
    tradingTax: 4000,
    i18n: { en: { name: 'Example Prime Set' }, 'zh-hans': { name: '示例 Prime 一套' } },
  },
};

function partDetail(slug, enName, zhName, quantityInSet) {
  return { data: { id: `part-for-${slug}`, slug, tags: ['prime'], quantityInSet, i18n: { en: { name: enName }, 'zh-hans': { name: zhName } } } };
}

function sealedOrders(platinum) {
  if (platinum === null) {
    return () => new Response('', { status: 503 });
  }
  return { data: { sell: [{ platinum, quantity: 1, visible: true, id: `synthetic-sell-${platinum}`, updatedAt: '2030-01-02T03:03:00Z', user: { ingameName: 'SyntheticTennoPart', status: 'online', platform: 'pc' } }], buy: [] } };
}

async function setQuery(fetchOverrides = {}) {
  const fetch = async (url) => {
    const override = fetchOverrides[url];
    if (override) return typeof override === 'function' ? override(url) : jsonResponse(override);
    if (url.endsWith('/v2/items')) return jsonResponse(SET_CATALOG);
    if (url.endsWith('/v2/item/example_prime_set')) return jsonResponse(SET_DETAIL);
    if (url.endsWith('/v2/orders/item/example_prime_set/top')) return jsonResponse(sealedOrders(45));
    if (url.endsWith('/v2/item/example_prime_neuroptics')) return jsonResponse(partDetail('example_prime_neuroptics', 'Example Prime Neuroptics', '示例 Prime 头部神经光元', 1));
    if (url.endsWith('/v2/orders/item/example_prime_neuroptics/top')) return jsonResponse(sealedOrders(8));
    if (url.endsWith('/v2/item/example_prime_chassis')) return jsonResponse(partDetail('example_prime_chassis', 'Example Prime Chassis', '示例 Prime 机体', 2));
    if (url.endsWith('/v2/orders/item/example_prime_chassis/top')) return jsonResponse(sealedOrders(11));
    if (url.endsWith('/v2/item/example_prime_systems')) return jsonResponse(partDetail('example_prime_systems', 'Example Prime Systems', '示例 Prime 系统', 1));
    if (url.endsWith('/v2/orders/item/example_prime_systems/top')) return new Response('', { status: 503 });
    if (url.endsWith('/v2/item/example_prime_blueprint')) return jsonResponse(partDetail('example_prime_blueprint', 'Example Prime Blueprint', '示例 Prime 蓝图', 1));
    if (url.endsWith('/v2/orders/item/example_prime_blueprint/top')) return jsonResponse(sealedOrders(12));
    if (url.endsWith('/v1/items/example_prime_set/statistics')) return jsonResponse({ payload: {} });
    throw new Error(`unexpected synthetic URL: ${url}`);
  };
  return new WarframeMarketQueryService({ fetch, now: () => NOW }).query({ ...REQUEST, item: '示例p' });
}

test('resolves set components from catalog/detail metadata with quantities and an explicit incomplete total', async () => {
  const result = await setQuery();
  assert.equal(result.ok, true);
  const set = result.data.set;
  assert.equal(set.root, true);
  assert.deepEqual(set.components.map((component) => component.slug), [
    'example_prime_neuroptics', 'example_prime_chassis', 'example_prime_systems', 'example_prime_blueprint',
  ]);
  assert.equal(set.components[1].quantity, 2);
  // 8*1 + 11*2 + 12*1 = 42; the missing systems quote never contributes zero.
  assert.equal(set.componentsTotal, 42);
  assert.equal(set.pricedCount, 3);
  assert.equal(set.missingCount, 1);
  assert.equal(set.setLowest, 45);
  assert.deepEqual(result.warnings.map((warning) => warning.code), ['NO_BUY_ORDERS', 'STATISTICS_UNAVAILABLE']);
});

test('keeps the comparison explicitly incomplete when every component quote is missing', async () => {
  const result = await setQuery({
    'https://api.warframe.market/v2/item/example_prime_neuroptics': () => new Response('', { status: 503 }),
    'https://api.warframe.market/v2/item/example_prime_chassis': () => new Response('', { status: 503 }),
    'https://api.warframe.market/v2/item/example_prime_systems': () => new Response('', { status: 503 }),
    'https://api.warframe.market/v2/item/example_prime_blueprint': () => new Response('', { status: 503 }),
  });
  assert.equal(result.ok, true);
  const set = result.data.set;
  assert.equal(set.root, true);
  assert.equal(set.pricedCount, 0);
  assert.equal(set.missingCount, 4);
  assert.equal(set.componentsTotal, null);
  assert.equal(set.setLowest, 45);
  assert.deepEqual(result.warnings.map((warning) => warning.code), ['NO_BUY_ORDERS', 'STATISTICS_UNAVAILABLE']);
});

test('keeps authoritative component quantity when only that component quote fails', async () => {
  const result = await setQuery({
    'https://api.warframe.market/v2/orders/item/example_prime_chassis/top': () => new Response('', { status: 503 }),
  });
  assert.equal(result.ok, true);
  const chassis = result.data.set.components.find((component) => component.slug === 'example_prime_chassis');
  assert.equal(chassis.quantity, 2);
  assert.equal(chassis.lowestSell, null);
  // Neuroptics 8 + blueprint 12; chassis and systems are explicitly missing.
  assert.equal(result.data.set.componentsTotal, 20);
  assert.equal(result.data.set.pricedCount, 2);
  assert.equal(result.data.set.missingCount, 2);
});

test('degrades the whole set section without failing the current-order snapshot', async () => {
  const noIds = structuredClone(SET_CATALOG);
  noIds.data.forEach((entry) => delete entry.id);
  const result = await setQuery({
    'https://api.warframe.market/v2/items': () => jsonResponse(noIds),
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.set, undefined);
  assert.equal(result.data.sellOrders.length, 1);
  assert.deepEqual(result.warnings.map((warning) => warning.code), ['NO_BUY_ORDERS', 'STATISTICS_UNAVAILABLE', 'SET_COMPONENTS_UNAVAILABLE']);
});
