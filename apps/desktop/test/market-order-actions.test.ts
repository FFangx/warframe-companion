import { describe, expect, it } from 'vitest';
import type { MarketQuerySuccess } from '@warframe-companion/market-query-contract';
import { MOCK_MARKET_QUERY_FAILURES, MOCK_MARKET_QUERY_REQUEST } from '@warframe-companion/market-query-contract/mocks';
import {
  buildWhisperText,
  createMarketSnapshotRegistry,
  performOrderCopy,
  presetOrderPreview,
  validOrderActionRequest,
} from '../src/market-order-actions.js';

export function successResult(overrides: Partial<{
  expiresAt: string;
  freshness: 'fresh' | 'stale';
  maxRank: number;
  sellers: Array<{ name: string; platinum: number; status: 'ingame' | 'online' | 'offline' | 'unknown'; rank: number | null }>;
  buyOrders: Array<{ name: string; platinum: number; status: 'ingame' | 'online' | 'offline' | 'unknown' }>;
}> = {}): MarketQuerySuccess {
  const sellers = overrides.sellers ?? [
    { name: 'SyntheticTennoC1', platinum: 10, status: 'ingame' as const, rank: 0 },
    { name: 'SyntheticTennoC2', platinum: 12, status: 'online' as const, rank: 1 },
  ];
  return {
    contractVersion: '1.0',
    ok: true,
    data: {
      requestedItem: 'Synthetic Prime Blueprint',
      item: {
        slug: 'synthetic_prime_blueprint',
        name: { en: 'Synthetic Prime Blueprint', zhHans: '合成 Prime 蓝图' },
        tags: ['prime', 'blueprint'],
        rank: { requested: 0, resolved: 0, maxRank: overrides.maxRank ?? 3 },
        ducats: 45,
        tradingTax: 4000,
        masteryRank: null,
      },
      sellOrders: sellers.map((seller, index) => ({
        side: 'sell', platinum: seller.platinum, quantity: index + 1, ingameName: seller.name, status: seller.status,
        platform: 'pc', crossplay: null, rank: seller.rank, updatedAt: '2030-01-02T03:03:00.000Z',
      })),
      buyOrders: (overrides.buyOrders ?? [{ name: 'SyntheticTennoBuyer', platinum: 8, status: 'online' as const }]).map((buyer, index) => ({
        side: 'buy', platinum: buyer.platinum, quantity: 1, ingameName: buyer.name, status: buyer.status,
        platform: 'pc', crossplay: null, rank: 0, updatedAt: '2030-01-02T03:02:00.000Z',
      })),
      statistics: { basis: 'closed_trades_90_days', median: 10, dailyVolume: 3.2, sampleSize: 288, rank: 0, asOf: '2030-01-02T03:04:05.000Z' },
    },
    evidence: {
      scope: 'current_market', evidenceType: 'direct_snapshot', asOf: '2030-01-02T03:04:05.000Z',
      expiresAt: overrides.expiresAt ?? '2030-01-02T03:09:05.000Z', freshness: overrides.freshness ?? 'fresh', finding: 'confirmed_present', source: 'warframe.market',
    },
    warnings: [],
  };
}

const FRESH_NOW = Date.parse('2030-01-02T03:05:00.000Z');

describe('desktop market order actions', () => {
  it('builds the exact legacy English /w template with the canonical item name and rank', () => {
    expect(buildWhisperText({ seller: 'SyntheticTennoA', itemName: 'Synthetic Prime Blueprint', rank: 3, platinum: 12 }))
      .toBe('/w SyntheticTennoA Hi! I want to buy: "Synthetic Prime Blueprint (rank 3)" for 12 platinum. (warframe.market)');
    expect(buildWhisperText({ seller: 'SyntheticTennoA', itemName: 'Synthetic Prime Blueprint', rank: 0, platinum: 7.5 }))
      .toBe('/w SyntheticTennoA Hi! I want to buy: "Synthetic Prime Blueprint (rank 0)" for 7.5 platinum. (warframe.market)');
  });

  it('previews an order with the English name and the resolved rank from the trusted snapshot only', () => {
    const registry = createMarketSnapshotRegistry();
    const id = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult({
      sellers: [{ name: 'SyntheticTennoC2', platinum: 12, status: 'online', rank: 1 }],
    }))!;
    const result = presetOrderPreview(registry, { snapshotId: id, side: 'sell', orderIndex: 0 }, FRESH_NOW);
    expect(result).toEqual({
      ok: true,
      preview: {
        text: '/w SyntheticTennoC2 Hi! I want to buy: "Synthetic Prime Blueprint (rank 0)" for 12 platinum. (warframe.market)',
        itemName: 'Synthetic Prime Blueprint',
        itemRank: 0,
        seller: 'SyntheticTennoC2',
        sellerStatus: 'online',
        sellerPlatform: 'pc',
        platinum: 12,
        purchaseQuantity: 1,
        inventory: 1,
      },
    });
  });

  it('registers only successful snapshots and gives each a distinct id', () => {
    const registry = createMarketSnapshotRegistry();
    expect(registry.register(MOCK_MARKET_QUERY_REQUEST, MOCK_MARKET_QUERY_FAILURES.unavailable)).toBeNull();
    const first = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult());
    const second = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult());
    expect(first).toMatch(/^snap-[a-z0-9-]+$/u);
    expect(second).toMatch(/^snap-[a-z0-9-]+$/u);
    expect(first).not.toBe(second);
    expect(registry.get(first!)?.result).toEqual(successResult());
  });

  it('rejects non-sell requests and out-of-range orders (no purchase entry for buy side)', () => {
    const registry = createMarketSnapshotRegistry();
    const id = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult())!;
    expect(validOrderActionRequest({ snapshotId: id, side: 'buy', orderIndex: 0 })).toBe(false);
    expect(presetOrderPreview(registry, { snapshotId: id, side: 'buy', orderIndex: 0 }, FRESH_NOW))
      .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(presetOrderPreview(registry, { snapshotId: id, side: 'sell', orderIndex: 99 }, FRESH_NOW))
      .toMatchObject({ ok: false, error: { code: 'ORDER_UNAVAILABLE' } });
    expect(validOrderActionRequest({ snapshotId: id, side: 'sell', orderIndex: 0, seller: 'InjectedTenno', platinum: 1 })).toBe(false);
    expect(presetOrderPreview(registry, { snapshotId: id, side: 'sell', orderIndex: -1 }, FRESH_NOW))
      .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(presetOrderPreview(registry, { snapshotId: id, side: 'sell', orderIndex: 1000 }, FRESH_NOW))
      .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(presetOrderPreview(registry, { snapshotId: 'snap-forged-1', side: 'sell', orderIndex: 0 }, FRESH_NOW))
      .toMatchObject({ ok: false, error: { code: 'SNAPSHOT_NOT_FOUND' } });
  });

  it('rejects preview and copy when the snapshot is expired or invalid', () => {
    const registry = createMarketSnapshotRegistry();
    const id = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult({ expiresAt: '2030-01-02T03:09:05.000Z' }))!;
    const expired = presetOrderPreview(registry, { snapshotId: id, side: 'sell', orderIndex: 0 }, Date.parse('2030-01-02T03:09:05.000Z'));
    expect(expired).toMatchObject({ ok: false, error: { code: 'EXPIRED' } });
    expect(performOrderCopy(registry, { snapshotId: id, side: 'sell', orderIndex: 0 }, Date.parse('2030-01-02T03:09:06.000Z'), () => {}))
      .toMatchObject({ ok: false, error: { code: 'EXPIRED' } });
    expect(presetOrderPreview(registry, { snapshotId: 'snap-unknown-1', side: 'sell', orderIndex: 0 }, FRESH_NOW))
      .toMatchObject({ ok: false, error: { code: 'SNAPSHOT_NOT_FOUND' } });
    expect(presetOrderPreview(registry, { snapshotId: id, side: 'sell', orderIndex: Number.NaN }, FRESH_NOW))
      .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('rejects preview and copy for an invalid expiry time and for stale evidence', () => {
    const registry = createMarketSnapshotRegistry();
    const invalidTimeId = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult({ expiresAt: 'not-a-date' }))!;
    expect(presetOrderPreview(registry, { snapshotId: invalidTimeId, side: 'sell', orderIndex: 0 }, FRESH_NOW))
      .toMatchObject({ ok: false, error: { code: 'EXPIRED' } });
    // A fresh-looking future time cannot pass either: the whole evidence is stale.
    const staleId = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult({ freshness: 'stale' }))!;
    expect(presetOrderPreview(registry, { snapshotId: staleId, side: 'sell', orderIndex: 0 }, FRESH_NOW))
      .toMatchObject({ ok: false, error: { code: 'EXPIRED' } });
    const written: string[] = [];
    expect(performOrderCopy(registry, { snapshotId: invalidTimeId, side: 'sell', orderIndex: 0 }, FRESH_NOW, (text) => written.push(text)))
      .toMatchObject({ ok: false, error: { code: 'EXPIRED' } });
    expect(performOrderCopy(registry, { snapshotId: staleId, side: 'sell', orderIndex: 0 }, FRESH_NOW, (text) => written.push(text)))
      .toMatchObject({ ok: false, error: { code: 'EXPIRED' } });
    expect(written).toHaveLength(0);
  });

  it('shows the seller stock as inventory, never as the purchase quantity', () => {
    const registry = createMarketSnapshotRegistry();
    const id = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult({
      sellers: [{ name: 'SyntheticTennoC1', platinum: 10, status: 'ingame', rank: 0 }, { name: 'SyntheticTennoC2', platinum: 12, status: 'online', rank: 0 }],
    }))!;
    const preview = presetOrderPreview(registry, { snapshotId: id, side: 'sell', orderIndex: 1 }, FRESH_NOW);
    expect(preview).toMatchObject({ ok: true });
    if (preview.ok) {
      expect(preview.preview.purchaseQuantity).toBe(1);
      expect(preview.preview.inventory).toBe(2);
      expect(preview.preview.text).toBe('/w SyntheticTennoC2 Hi! I want to buy: "Synthetic Prime Blueprint (rank 0)" for 12 platinum. (warframe.market)');
    }
  });

  it('copies only after explicit user action and verifies again at execution time (preview-then-expire)', () => {
    const registry = createMarketSnapshotRegistry();
    const id = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult())!;
    const written: string[] = [];
    const fresh = performOrderCopy(registry, { snapshotId: id, side: 'sell', orderIndex: 0 }, FRESH_NOW, (text) => written.push(text));
    expect(fresh).toEqual({ ok: true });
    expect(written).toEqual(['/w SyntheticTennoC1 Hi! I want to buy: "Synthetic Prime Blueprint (rank 0)" for 10 platinum. (warframe.market)']);
    // Preview succeeded at 03:05, copy happens after expiry at 03:10: must be rejected.
    const input = { snapshotId: id, side: 'sell', orderIndex: 0 };
    expect(presetOrderPreview(registry, input, FRESH_NOW)).toMatchObject({ ok: true });
    expect(performOrderCopy(registry, input, Date.parse('2030-01-02T03:10:00.000Z'), (text) => written.push(text)))
      .toMatchObject({ ok: false, error: { code: 'EXPIRED' } });
    expect(written).toHaveLength(1);
  });

  it('reports clipboard failures without reporting success', () => {
    const registry = createMarketSnapshotRegistry();
    const id = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult())!;
    expect(performOrderCopy(registry, { snapshotId: id, side: 'sell', orderIndex: 0 }, FRESH_NOW, () => { throw new Error('denied'); }))
      .toMatchObject({ ok: false, error: { code: 'CLIPBOARD_FAILED' } });
  });

  it('evicts the oldest snapshots to keep the registry bounded', () => {
    const registry = createMarketSnapshotRegistry(2);
    const first = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult())!;
    const second = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult())!;
    const third = registry.register(MOCK_MARKET_QUERY_REQUEST, successResult())!;
    expect(registry.size).toBe(2);
    expect(registry.get(first)).toBeUndefined();
    expect(registry.get(second)).toBeDefined();
    expect(registry.get(third)).toBeDefined();
  });
});
