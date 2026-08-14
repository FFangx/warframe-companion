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
  assert.equal(f.calls.length, 2);
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
  assert.equal(f.calls.length, 2);
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
