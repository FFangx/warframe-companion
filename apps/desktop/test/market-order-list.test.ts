import { describe, expect, it } from 'vitest';
import type { MarketOrder, MarketQuerySuccess, MarketUserStatus } from '@warframe-companion/market-query-contract';
import { clampPage, collectOrders, filterOrders, ORDER_PAGE_SIZE, pageFor, type OrderRow } from '../src/renderer/market-order-list.js';

function order(index: number, side: 'sell' | 'buy', status: MarketUserStatus, platinum: number): MarketOrder {
  return {
    side, platinum, quantity: 1, ingameName: `SyntheticTennoP${index}`, status,
    platform: 'pc', crossplay: null, rank: 0, updatedAt: '2030-01-02T03:03:00.000Z',
  };
}

function result(rows: OrderRow[]): MarketQuerySuccess {
  return {
    contractVersion: '1.0',
    ok: true,
    data: {
      requestedItem: 'Synthetic Prime',
      item: {
        slug: 'synthetic_prime', name: { en: 'Synthetic Prime', zhHans: '合成 Prime' }, tags: ['prime'],
        rank: { requested: 0, resolved: 0, maxRank: 0 }, ducats: null, tradingTax: null, masteryRank: null,
      },
      sellOrders: rows.filter((row) => row.side === 'sell').map((row) => row.order),
      buyOrders: rows.filter((row) => row.side === 'buy').map((row) => row.order),
    },
    evidence: {
      scope: 'current_market', evidenceType: 'direct_snapshot', asOf: '2030-01-02T03:04:05.000Z',
      expiresAt: '2030-01-02T03:09:05.000Z', freshness: 'fresh', finding: 'confirmed_present', source: 'warframe.market',
    },
    warnings: [],
  };
}

describe('desktop market order list', () => {
  it('flattens sell orders first then buy orders, keeping source indices', () => {
    const rows = collectOrders(result([
      { side: 'sell', sourceIndex: 0, order: order(0, 'sell', 'online', 10) },
      { side: 'sell', sourceIndex: 1, order: order(1, 'sell', 'ingame', 12) },
      { side: 'buy', sourceIndex: 0, order: order(2, 'buy', 'offline', 8) },
    ]));
    expect(rows.map((row) => `${row.side}#${row.sourceIndex}`)).toEqual(['sell#0', 'sell#1', 'buy#0']);
    expect(rows[1]?.order.ingameName).toBe('SyntheticTennoP1');
  });

  it('filters by side and online status, and distinguishes filtered-empty from snapshot-empty', () => {
    const rows = collectOrders(result([
      { side: 'sell', sourceIndex: 0, order: order(0, 'sell', 'ingame', 10) },
      { side: 'sell', sourceIndex: 1, order: order(1, 'sell', 'offline', 12) },
      { side: 'buy', sourceIndex: 0, order: order(2, 'buy', 'online', 8) },
    ]));
    expect(rows.length).toBe(3);
    const sells = filterOrders(rows, 'sell', 'all');
    expect(sells).toHaveLength(2);
    expect(filterOrders(rows, 'buy', 'all')).toHaveLength(1);
    const ingameSells = filterOrders(rows, 'sell', 'ingame');
    expect(ingameSells.map((row) => row.order.ingameName)).toEqual(['SyntheticTennoP0']);
    const snapshotEmpty = collectOrders(result([]));
    expect(snapshotEmpty.length).toBe(0);
    expect(filterOrders(snapshotEmpty, 'all', 'all').length).toBe(0);
    const filteredEmpty = filterOrders(rows, 'buy', 'ingame');
    expect(filteredEmpty.length).toBe(0);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('paginates within the snapshot and clamps an out-of-range page', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      side: (index % 2 === 0 ? 'sell' : 'buy') as 'sell' | 'buy',
      sourceIndex: Math.floor(index / 2),
      order: order(index, index % 2 === 0 ? 'sell' : 'buy', 'online', index),
    }));
    expect(ORDER_PAGE_SIZE).toBe(5);
    const first = pageFor(rows, 1);
    expect(first.rows).toHaveLength(5);
    expect(first.totalPages).toBe(3);
    expect(first.from).toBe(0);
    const second = pageFor(rows, 2);
    expect(second.rows.map((row) => row.order.ingameName)).toEqual(['SyntheticTennoP5', 'SyntheticTennoP6', 'SyntheticTennoP7', 'SyntheticTennoP8', 'SyntheticTennoP9']);
    const third = pageFor(rows, 3);
    expect(third.rows).toHaveLength(2);
    expect(third.to).toBe(12);
    expect(pageFor(rows, 99).page).toBe(3);
    expect(pageFor(rows, -5).page).toBe(1);
    expect(pageFor([], 1).rows).toHaveLength(0);
    expect(pageFor([], 1).totalPages).toBe(1);
    expect(clampPage(0, 0)).toBe(1);
    expect(clampPage(9, 3)).toBe(3);
  });
});
