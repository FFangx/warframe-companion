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
});
