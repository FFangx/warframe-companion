import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DROP_SEARCH_CONTRACT_VERSION, WarframeDataService } from '../dist/index.js';

const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'warframe-data-live-'));
try {
  const service = new WarframeDataService({ cacheDirectory });
  const live = await service.searchDrops({ contractVersion: DROP_SEARCH_CONTRACT_VERSION, item: '神经元', limit: 5 });
  assert.equal(live.ok, true, live.ok ? undefined : `${live.error.code}: ${live.error.message}`);
  assert.equal(live.data.resolvedItem, 'Neurodes');
  assert.equal(live.data.match, 'alias_exact');
  assert.equal(live.data.alias.license, 'MIT');
  assert.notEqual(live.evidence.sourceAge.status, 'rejected');
  assert.ok(['matched', 'different', 'primary_only', 'alternative_only', 'primary_payload_only', 'alternative_payload_only'].includes(live.evidence.alternativeComparison.status));
  assert.ok(live.data.totalDrops > 0);

  const offline = new WarframeDataService({
    cacheDirectory,
    fetch: async () => { throw new Error('fresh cache smoke must remain offline'); },
  });
  const cached = await offline.searchDrops({ contractVersion: DROP_SEARCH_CONTRACT_VERSION, item: 'Neurode', limit: 1 });
  assert.equal(cached.ok, true);
  assert.equal(cached.evidence.cacheFreshness, 'fresh');
  assert.equal(cached.data.resolvedItem, 'Neurodes');

  process.stdout.write(`${JSON.stringify({
    resolvedItem: live.data.resolvedItem,
    totalDrops: live.data.totalDrops,
    sourceHash: live.evidence.sourceHash,
    sourceModifiedAt: live.evidence.asOf,
    sourceAgeStatus: live.evidence.sourceAge.status,
    sourceAgeMs: live.evidence.sourceAge.ageMs,
    cacheFreshness: live.evidence.cacheFreshness,
    selectedEndpoint: live.evidence.selectedEndpoint,
    alternativeComparison: live.evidence.alternativeComparison.status,
    discardedRowsWarning: live.warnings.some((entry) => entry.code === 'SOURCE_ROWS_DISCARDED'),
    offlineCacheVerified: true,
  }, null, 2)}\n`);
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
