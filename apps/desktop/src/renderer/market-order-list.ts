import type { MarketOrderSide, MarketQuerySuccess, MarketUserStatus } from '@warframe-companion/market-query-contract';

/** Rows per page inside the current order snapshot. */
export const ORDER_PAGE_SIZE = 5;

export type OrderSideFilter = 'all' | MarketOrderSide;
export type OrderStatusFilter = 'all' | MarketUserStatus;

export interface OrderRow {
  side: MarketOrderSide;
  /** Index of the order inside its source snapshot array (stable identity). */
  sourceIndex: number;
  order: import('@warframe-companion/market-query-contract').MarketOrder;
}

/** Flattens the snapshot into a single list: sell orders first, then buy orders. */
export function collectOrders(result: MarketQuerySuccess): OrderRow[] {
  return [
    ...result.data.sellOrders.map((order, sourceIndex) => ({ side: 'sell' as const, sourceIndex, order })),
    ...result.data.buyOrders.map((order, sourceIndex) => ({ side: 'buy' as const, sourceIndex, order })),
  ];
}

export function filterOrders(rows: OrderRow[], side: OrderSideFilter, status: OrderStatusFilter): OrderRow[] {
  return rows.filter((row) => (side === 'all' || row.side === side) && (status === 'all' || row.order.status === status));
}

/** Keeps the requested page inside 1..totalPages; invalid positions collapse to 1. */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || totalPages <= 0) return 1;
  return Math.min(Math.max(1, Math.floor(page)), totalPages);
}

export interface OrderPage {
  rows: OrderRow[];
  page: number;
  totalPages: number;
  from: number;
  to: number;
}

export function pageFor(rows: OrderRow[], page: number, pageSize = ORDER_PAGE_SIZE): OrderPage {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = clampPage(page, totalPages);
  const from = (current - 1) * pageSize;
  const to = Math.min(from + pageSize, rows.length);
  return { rows: rows.slice(from, to), page: current, totalPages, from, to };
}
