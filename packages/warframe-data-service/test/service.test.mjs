import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DROP_SEARCH_CONTRACT_VERSION, WarframeDataService } from '../dist/index.js';

const NOW = new Date('2030-01-02T03:04:05.000Z');
const INFO = { hash: 'synthetic-hash', timestamp: NOW.getTime(), modified: NOW.getTime() - 60_000 };
const DROPS = [
  { place: 'Earth/E Prime (<b>Exterminate</b>)', item: 'Example Blueprint', rarity: 'Rare', chance: 2.5 },
  { place: 'Venus/Aphrodite (<b>Capture</b>)', item: 'Example Blueprint', rarity: 'Uncommon', chance: 8.5 },
  { place: 'Void/Test', item: 'Example Barrel', rarity: 'Rare', chance: '3.00' },
  { place: 'Earth/Cervantes', item: 'Neurodes', rarity: 'Common', chance: 12.5 },
  { place: 'Void/Invalid', item: 'Invalid Chance Item', rarity: 'Legendary', chance: 'NaN' },
];
const request = (item, limit) => ({ contractVersion: DROP_SEARCH_CONTRACT_VERSION, item, ...(limit ? { limit } : {}) });
const response = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'warframe-data-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/info.json')) return response(INFO);
    if (url.endsWith('/all.slim.json')) return response(DROPS);
    throw new Error(`unexpected ${url}`);
  };
  return { directory, fetch, calls };
}

test('refreshes, validates and indexes a public snapshot without SQLite', async (t) => {
  const f = await fixture(t);
  const result = await new WarframeDataService({ cacheDirectory: f.directory, fetch: f.fetch, now: () => NOW }).searchDrops(request('example blueprint', 1));
  assert.equal(result.ok, true);
  assert.equal(result.data.resolvedItem, 'Example Blueprint');
  assert.equal(result.data.match, 'normalized_exact');
  assert.equal(result.data.totalDrops, 2);
  assert.equal(result.data.drops[0].chance, 8.5);
  assert.equal(result.data.drops[0].place.includes('<b>'), false);
  assert.equal(result.evidence.sourceHash, 'synthetic-hash');
  assert.deepEqual(result.warnings.map((entry) => entry.code), ['SOURCE_ROWS_DISCARDED', 'RESULT_TRUNCATED']);
  assert.equal(f.calls.length, 3);
});

test('reuses a fresh on-disk snapshot without network', async (t) => {
  const f = await fixture(t);
  await new WarframeDataService({ cacheDirectory: f.directory, fetch: f.fetch, now: () => NOW }).searchDrops(request('Example Blueprint'));
  const offline = new WarframeDataService({
    cacheDirectory: f.directory, now: () => new Date(NOW.getTime() + 60_000),
    fetch: async () => { throw new Error('network must not be used'); },
  });
  const result = await offline.searchDrops(request('Example Blueprint'));
  assert.equal(result.ok, true);
  assert.equal(result.evidence.freshness, 'fresh');
});

test('coalesces concurrent first loads into one refresh', async (t) => {
  const f = await fixture(t);
  const service = new WarframeDataService({ cacheDirectory: f.directory, fetch: f.fetch, now: () => NOW });
  const [first, second] = await Promise.all([
    service.searchDrops(request('Example Blueprint')),
    service.searchDrops(request('Example Barrel')),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(f.calls.length, 3);
});

test('falls back to a stale validated snapshot and labels evidence', async (t) => {
  const f = await fixture(t);
  await new WarframeDataService({ cacheDirectory: f.directory, fetch: f.fetch, now: () => NOW }).searchDrops(request('Example Blueprint'));
  const offline = new WarframeDataService({
    cacheDirectory: f.directory, now: () => new Date(NOW.getTime() + 2_000), ttlMs: 1,
    fetch: async () => new Response('', { status: 503 }),
  });
  const result = await offline.searchDrops(request('Example Blueprint'));
  assert.equal(result.ok, true);
  assert.equal(result.evidence.freshness, 'stale');
  assert.deepEqual(result.warnings.map((entry) => entry.code), ['STALE_SNAPSHOT', 'SOURCE_ROWS_DISCARDED']);
});

test('distinguishes ambiguous, not-found, invalid and unavailable outcomes', async (t) => {
  const f = await fixture(t);
  const service = new WarframeDataService({ cacheDirectory: f.directory, fetch: f.fetch, now: () => NOW });
  const ambiguous = await service.searchDrops(request('Example'));
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error.code, 'ITEM_AMBIGUOUS');
  assert.deepEqual(ambiguous.error.candidates, ['Example Blueprint', 'Example Barrel']);
  const missing = await service.searchDrops(request('Nothing Synthetic'));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'ITEM_NOT_FOUND');
  assert.equal((await service.searchDrops({ item: 'Example' })).error.code, 'INVALID_REQUEST');
  assert.equal((await service.searchDrops(request('...'))).error.code, 'INVALID_REQUEST');
  const unavailable = await new WarframeDataService({ cacheDirectory: path.join(f.directory, 'empty'), fetch: async () => new Response('', { status: 503 }) }).searchDrops(request('Example'));
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, 'SOURCE_UNAVAILABLE');
  assert.equal(unavailable.error.retryable, true);
});

test('resolves maintained Chinese and English aliases with explicit MIT attribution', async (t) => {
  const f = await fixture(t);
  const service = new WarframeDataService({ cacheDirectory: f.directory, fetch: f.fetch, now: () => NOW });
  const chinese = await service.searchDrops(request('神经元'));
  assert.equal(chinese.ok, true);
  assert.equal(chinese.data.resolvedItem, 'Neurodes');
  assert.equal(chinese.data.match, 'alias_exact');
  assert.deepEqual(chinese.data.alias, {
    matched: '神经元', language: 'zh-Hans', canonicalItem: 'Neurodes',
    source: 'warframe-companion.project-aliases', license: 'MIT',
  });
  const english = await service.searchDrops(request('Neurode'));
  assert.equal(english.ok, true);
  assert.equal(english.data.alias.language, 'en');
});

test('separates fresh cache state from aged source data and rejects data beyond the source-age gate', async (t) => {
  const f = await fixture(t);
  const oldInfo = { ...INFO, modified: NOW.getTime() - 15 * 86_400_000 };
  const fetch = async (url) => response(url.endsWith('/info.json') ? oldInfo : DROPS);
  const result = await new WarframeDataService({ cacheDirectory: f.directory, fetch, now: () => NOW, sourceAgeWarningMs: 3 * 86_400_000, maxSourceAgeMs: 14 * 86_400_000 }).searchDrops(request('Example Blueprint'));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SOURCE_TOO_OLD');
  assert.equal(result.error.retryable, true);
  assert.equal(result.evidence.cacheFreshness, 'fresh');
  assert.equal(result.evidence.sourceAge.status, 'rejected');
  assert.equal(result.evidence.finding, 'unavailable');
});

test('allows an aged-but-within-gate source while warning independently of cache freshness', async (t) => {
  const f = await fixture(t);
  const agedInfo = { ...INFO, modified: NOW.getTime() - 5 * 86_400_000 };
  const fetch = async (url) => response(url.endsWith('/info.json') ? agedInfo : DROPS);
  const result = await new WarframeDataService({ cacheDirectory: f.directory, fetch, now: () => NOW, sourceAgeWarningMs: 3 * 86_400_000, maxSourceAgeMs: 14 * 86_400_000 }).searchDrops(request('Example Blueprint'));
  assert.equal(result.ok, true);
  assert.equal(result.evidence.cacheFreshness, 'fresh');
  assert.equal(result.evidence.sourceAge.status, 'aged');
  assert.ok(result.warnings.some((entry) => entry.code === 'SOURCE_DATA_AGED'));
});

test('compares the licensed alternative endpoint and selects its newer source version', async (t) => {
  const f = await fixture(t);
  const primaryInfo = { hash: 'primary-old', timestamp: NOW.getTime(), modified: NOW.getTime() - 120_000 };
  const alternativeInfo = { hash: 'alternative-new', timestamp: NOW.getTime(), modified: NOW.getTime() - 30_000 };
  const fetch = async (url) => {
    if (url === 'https://primary.test/info.json') return response(primaryInfo);
    if (url === 'https://alternative.test/info.json') return response(alternativeInfo);
    if (url === 'https://alternative.test/all.slim.json') return response(DROPS);
    throw new Error(`unexpected ${url}`);
  };
  const result = await new WarframeDataService({
    cacheDirectory: f.directory, fetch, now: () => NOW,
    baseUrl: 'https://primary.test', alternativeBaseUrl: 'https://alternative.test',
  }).searchDrops(request('Example Blueprint'));
  assert.equal(result.ok, true);
  assert.equal(result.evidence.selectedEndpoint, 'wfcd.github-raw');
  assert.equal(result.evidence.alternativeComparison.status, 'different');
  assert.equal(result.evidence.alternativeComparison.preferred, 'alternative');
  assert.ok(result.warnings.some((entry) => entry.code === 'ALTERNATIVE_SOURCE_SELECTED'));
  assert.ok(result.warnings.some((entry) => entry.code === 'SOURCE_MIRROR_DIVERGED'));
});

test('falls back explainably when the preferred alternative metadata is newer but its payload fails', async (t) => {
  const f = await fixture(t);
  const primaryInfo = { hash: 'primary-usable', timestamp: NOW.getTime(), modified: NOW.getTime() - 120_000 };
  const alternativeInfo = { hash: 'alternative-newer', timestamp: NOW.getTime(), modified: NOW.getTime() - 30_000 };
  const fetch = async (url) => {
    if (url === 'https://primary.test/info.json') return response(primaryInfo);
    if (url === 'https://alternative.test/info.json') return response(alternativeInfo);
    if (url === 'https://alternative.test/all.slim.json') return new Response('', { status: 503 });
    if (url === 'https://primary.test/all.slim.json') return response(DROPS);
    throw new Error(`unexpected ${url}`);
  };
  const result = await new WarframeDataService({
    cacheDirectory: f.directory, fetch, now: () => NOW,
    baseUrl: 'https://primary.test', alternativeBaseUrl: 'https://alternative.test',
  }).searchDrops(request('Example Blueprint'));
  assert.equal(result.ok, true);
  assert.equal(result.evidence.selectedEndpoint, 'wfcd.jsdelivr');
  assert.equal(result.evidence.alternativeComparison.status, 'primary_payload_only');
  assert.equal(result.evidence.alternativeComparison.reason, 'payload_fallback');
  assert.ok(result.warnings.some((entry) => entry.code === 'ALTERNATIVE_SOURCE_UNAVAILABLE'));
});
