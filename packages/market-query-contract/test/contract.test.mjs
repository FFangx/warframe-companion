import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MARKET_QUERY_CONTRACT_VERSION,
  MarketContractViolation,
  assertMarketQueryRequest,
  assertMarketQueryResult,
  isMarketQueryResult,
} from '../dist/index.js';
import {
  MOCK_MARKET_QUERY_FAILURES,
  MOCK_MARKET_QUERY_NO_ORDERS,
  MOCK_MARKET_QUERY_REQUEST,
  MOCK_MARKET_QUERY_RESULTS,
  MOCK_MARKET_QUERY_SET_SUCCESS,
  MOCK_MARKET_QUERY_SUCCESS,
} from '../dist/mock-fixtures.js';

test('accepts the canonical request and every published mock result', () => {
  assertMarketQueryRequest(MOCK_MARKET_QUERY_REQUEST);
  for (const fixture of MOCK_MARKET_QUERY_RESULTS) {
    assertMarketQueryResult(fixture);
    assert.equal(isMarketQueryResult(fixture), true);
    assert.equal(fixture.contractVersion, MARKET_QUERY_CONTRACT_VERSION);
  }
});

test('distinguishes an empty successful snapshot from source failure', () => {
  assert.equal(MOCK_MARKET_QUERY_NO_ORDERS.ok, true);
  assert.deepEqual(MOCK_MARKET_QUERY_NO_ORDERS.data.sellOrders, []);
  assert.equal(MOCK_MARKET_QUERY_NO_ORDERS.evidence.finding, 'confirmed_absent_in_scope');
  assert.equal(MOCK_MARKET_QUERY_FAILURES.unavailable.ok, false);
  assert.equal(MOCK_MARKET_QUERY_FAILURES.unavailable.error.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(MOCK_MARKET_QUERY_FAILURES.unavailable.evidence.finding, 'unavailable');
});

test('keeps buy and sell order direction explicit', () => {
  assert.equal(MOCK_MARKET_QUERY_SUCCESS.data.sellOrders[0].side, 'sell');
  assert.equal(MOCK_MARKET_QUERY_SUCCESS.data.buyOrders[0].side, 'buy');
  const invalid = structuredClone(MOCK_MARKET_QUERY_SUCCESS);
  invalid.data.sellOrders[0].side = 'buy';
  assert.throws(() => assertMarketQueryResult(invalid), /sellOrders\[0\]\.side/u);
});

test('rejects hidden platform defaults, invalid ranks, and unknown request fields', () => {
  const missingPlatform = { ...MOCK_MARKET_QUERY_REQUEST };
  delete missingPlatform.platform;
  assert.throws(() => assertMarketQueryRequest(missingPlatform), /platform/u);
  assert.throws(() => assertMarketQueryRequest({ ...MOCK_MARKET_QUERY_REQUEST, rank: -1 }), /rank/u);
  assert.throws(() => assertMarketQueryRequest({ ...MOCK_MARKET_QUERY_REQUEST, token: 'must-not-pass' }), /未定义字段/u);
});

test('enforces code/category/retryability invariants', () => {
  const wrongCategory = structuredClone(MOCK_MARKET_QUERY_FAILURES.timeout);
  wrongCategory.error.category = 'validation';
  assert.throws(() => assertMarketQueryResult(wrongCategory), /category/u);
  const wrongRetry = structuredClone(MOCK_MARKET_QUERY_FAILURES.timeout);
  wrongRetry.error.retryable = false;
  assert.throws(() => assertMarketQueryResult(wrongRetry), /retryable/u);
});

test('rejects raw causes, stacks, and other undeclared failure details', () => {
  for (const leaked of [
    { ...MOCK_MARKET_QUERY_FAILURES.internal, error: { ...MOCK_MARKET_QUERY_FAILURES.internal.error, stack: 'private path' } },
    { ...MOCK_MARKET_QUERY_FAILURES.internal, error: { ...MOCK_MARKET_QUERY_FAILURES.internal.error, cause: 'raw upstream body' } },
    { ...MOCK_MARKET_QUERY_FAILURES.internal, error: { ...MOCK_MARKET_QUERY_FAILURES.internal.error, details: { raw: 'payload' } } },
  ]) {
    assert.throws(() => assertMarketQueryResult(leaked), MarketContractViolation);
  }
});

test('mock fixtures contain only synthetic identities and no sensitive field names', () => {
  const serialized = JSON.stringify(MOCK_MARKET_QUERY_RESULTS);
  assert.doesNotMatch(serialized, /(?:api[_-]?key|authorization|bearer|cookie|token|account[_-]?id|user[_-]?id|qq|email|stack|cause|raw)/iu);
  assert.doesNotMatch(serialized, /[A-Z]:\\|@(?:gmail|outlook|qq)\./iu);
  for (const order of [...MOCK_MARKET_QUERY_SUCCESS.data.sellOrders, ...MOCK_MARKET_QUERY_SUCCESS.data.buyOrders]) {
    assert.match(order.ingameName, /^SyntheticTenno/u);
  }
  for (const component of MOCK_MARKET_QUERY_SET_SUCCESS.data.set.components) {
    assert.match(component.slug, /^example_/u);
  }
});

test('accepts the D1c set comparison fixture with a partial component total', () => {
  assertMarketQueryResult(MOCK_MARKET_QUERY_SET_SUCCESS);
  const set = MOCK_MARKET_QUERY_SET_SUCCESS.data.set;
  assert.equal(set.root, true);
  assert.equal(set.pricedCount, 3);
  assert.equal(set.missingCount, 1);
  assert.equal(set.setLowest, 45);
  // 8 + 11 + 12 = 31; the missing system blueprint never contributes a zero.
  assert.equal(set.componentsTotal, 31);
});

test('rejects bounded URL, locale, reputation, and deviation violations', () => {
  const withImage = (image) => {
    const clone = structuredClone(MOCK_MARKET_QUERY_SUCCESS);
    clone.data.item.image = image;
    return clone;
  };
  assert.throws(() => assertMarketQueryResult(withImage({ thumb: 'javascript:alert(1)', icon: null, subIcon: null })), /静态资源/u);
  assert.throws(() => assertMarketQueryResult(withImage({ thumb: 'https://evil.example/x.png', icon: null, subIcon: null })), /静态资源/u);
  assert.throws(() => assertMarketQueryResult(withImage({ thumb: 'https://warframe.market/static/assets/../secret.png', icon: null, subIcon: null })), /静态资源/u);
  assert.throws(() => assertMarketQueryResult(withImage({ thumb: 'https://warframe.market/other/x.png', icon: null, subIcon: null })), /静态资源/u);
  assert.throws(() => assertMarketQueryResult(withImage({ thumb: 'https://warframe.market/static/assets/' + 'a'.repeat(250), icon: null, subIcon: null })), /静态资源/u);

  const withOrder = (patch) => {
    const clone = structuredClone(MOCK_MARKET_QUERY_SUCCESS);
    Object.assign(clone.data.sellOrders[0], patch);
    return clone;
  };
  assert.throws(() => assertMarketQueryResult(withOrder({ locale: 'zh_hans' })), /语言标签/u);
  assert.throws(() => assertMarketQueryResult(withOrder({ locale: 'zh' + '-x'.repeat(30) })), /语言标签/u);
  assert.throws(() => assertMarketQueryResult(withOrder({ locale: 42 })), /语言标签/u);
  assert.throws(() => assertMarketQueryResult(withOrder({ reputation: 'high' })), /数值/u);
  assert.throws(() => assertMarketQueryResult(withOrder({ reputation: 2_000_000 })), /范围/u);

  const invalidDeviation = structuredClone(MOCK_MARKET_QUERY_SUCCESS);
  invalidDeviation.data.statistics.deviationPct = 10_000;
  assert.throws(() => assertMarketQueryResult(invalidDeviation), /范围/u);
});

test('rejects incomplete, fabricated, or inconsistent set comparisons', () => {
  const clone = () => structuredClone(MOCK_MARKET_QUERY_SET_SUCCESS);
  const withSet = (patch) => {
    const next = clone();
    Object.assign(next.data.set, patch);
    return next;
  };
  // A priced component list must never be summarized as null (zero-price fabrication).
  assert.throws(() => assertMarketQueryResult(withSet({ componentsTotal: null })), /componentsTotal/u);
  // An empty quote list must never claim a complete total.
  const emptyQuotes = {
    components: clone().data.set.components.map((component) => ({ ...component, lowestSell: null })),
  };
  assert.throws(() => assertMarketQueryResult(withSet({ ...emptyQuotes, pricedCount: 0, missingCount: 4, componentsTotal: 999 })), /componentsTotal/u);
  // Counts must be consistent with the component array.
  assert.throws(() => assertMarketQueryResult(withSet({ pricedCount: 2, missingCount: 3 })), /pricedCount/u);
  assert.throws(() => assertMarketQueryResult(withSet({ pricedCount: 2, missingCount: 2 })), /报价计数/u);
  assert.throws(() => assertMarketQueryResult(withSet({ componentsTotal: 999 })), /按数量求和/u);
  assert.throws(() => assertMarketQueryResult(withSet({ setLowest: 44 })), /最低卖价/u);
  // Quantity bounds.
  const badQuantity = clone();
  badQuantity.data.set.components[0].quantity = 0;
  assert.throws(() => assertMarketQueryResult(badQuantity), /quantity/u);
  // Component array bound.
  const tooMany = clone();
  tooMany.data.set.components = Array.from({ length: 25 }, (_, index) => ({
    slug: `example_part_${index}`, name: { en: `Part ${index}`, zhHans: `部件 ${index}` }, quantity: 1, lowestSell: 1,
  }));
  tooMany.data.set.pricedCount = tooMany.data.set.components.length;
  tooMany.data.set.missingCount = 0;
  tooMany.data.set.componentsTotal = 25;
  assert.throws(() => assertMarketQueryResult(tooMany), /至多/u);
  // Unknown field inside set components.
  const extra = clone();
  extra.data.set.components[0].quoteAt = '2029-01-01T00:00:00.000Z';
  assert.throws(() => assertMarketQueryResult(extra), /未定义字段/u);
});

test('rejects order arrays and warnings beyond the bounded limits', () => {
  const clone = structuredClone(MOCK_MARKET_QUERY_SUCCESS);
  clone.data.sellOrders = Array.from({ length: 51 }, (_, index) => ({
    ...clone.data.sellOrders[0],
    ingameName: `SyntheticTennoX${index}`,
  }));
  assert.throws(() => assertMarketQueryResult(clone), /至多/u);

  const warnings = structuredClone(MOCK_MARKET_QUERY_SUCCESS);
  warnings.warnings = Array.from({ length: 13 }, () => ({ code: 'STALE_DATA', message: 'w' }));
  assert.throws(() => assertMarketQueryResult(warnings), /至多/u);
});
