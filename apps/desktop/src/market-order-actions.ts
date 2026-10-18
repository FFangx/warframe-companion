import type {
  MarketOrder,
  MarketPlatform,
  MarketQueryRequest,
  MarketQueryResult,
  MarketQuerySuccess,
  MarketUserStatus,
} from '@warframe-companion/market-query-contract';

/**
 * Desktop-only market order actions.
 *
 * The main process keeps the trusted snapshots it produced itself. The
 * renderer only references a snapshot by id and an order by index inside
 * that snapshot; it never supplies seller identity, price or time, so it
 * cannot fabricate a "trusted" order. Expiry is checked
 * again with the main process clock at every execution point (preview AND
 * copy).
 *
 * The `/w` text uses the legacy warframe.market English template with the
 * canonical English item name and the resolved rank from the snapshot.
 *
 * Seller identity and the private-message text never leave this module
 * through the agent channel: they are only delivered to the renderer for
 * display through the dedicated order-action IPC, and are never logged.
 */

export interface MarketSnapshotEntry {
  id: string;
  request: MarketQueryRequest;
  result: MarketQueryResult;
  createdAt: number;
}

export interface MarketSnapshotRegistry {
  readonly size: number;
  register(request: MarketQueryRequest, result: MarketQueryResult, now?: number): string | null;
  get(id: string): MarketSnapshotEntry | undefined;
}

export function createMarketSnapshotRegistry(maxEntries = 40): MarketSnapshotRegistry {
  const entries = new Map<string, MarketSnapshotEntry>();
  let sequence = 0;
  return {
    get size() {
      return entries.size;
    },
    register(request: MarketQueryRequest, result: MarketQueryResult, now = Date.now()): string | null {
      if (!result.ok) return null;
      sequence += 1;
      const id = `snap-${now.toString(36)}-${sequence.toString(36)}`;
      entries.set(id, { id, request, result, createdAt: now });
      while (entries.size > maxEntries) {
        let oldest: MarketSnapshotEntry | undefined;
        for (const entry of entries.values()) {
          if (!oldest || entry.createdAt < oldest.createdAt) oldest = entry;
        }
        if (!oldest) break;
        entries.delete(oldest.id);
      }
      return id;
    },
    get(id: string) {
      return entries.get(id);
    },
  };
}

export interface OrderActionRequest {
  snapshotId: string;
  side: 'sell';
  orderIndex: number;
}

const SNAPSHOT_ID_PATTERN = /^snap-[a-z0-9-]{1,64}$/u;
const MAX_ORDER_INDEX = 999;

export function validOrderActionRequest(value: unknown): value is OrderActionRequest {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  return keys.length === 3 && keys.every((key) => key === 'snapshotId' || key === 'side' || key === 'orderIndex')
    && typeof input.snapshotId === 'string' && SNAPSHOT_ID_PATTERN.test(input.snapshotId)
    && input.side === 'sell'
    && Number.isInteger(input.orderIndex) && Number(input.orderIndex) >= 0 && Number(input.orderIndex) <= MAX_ORDER_INDEX;
}

export type OrderActionErrorCode =
  | 'INVALID_REQUEST'
  | 'SNAPSHOT_NOT_FOUND'
  | 'EXPIRED'
  | 'ORDER_UNAVAILABLE'
  | 'CLIPBOARD_FAILED';

export interface OrderActionError {
  code: OrderActionErrorCode;
  message: string;
}

export interface OrderPreview {
  text: string;
  /** Canonical English item name used inside the whisper. */
  itemName: string;
  itemRank: number;
  seller: string;
  sellerStatus: MarketUserStatus;
  sellerPlatform: MarketPlatform;
  platinum: number;
  /** D1b always buys exactly one unit; there is no quantity selector yet. */
  purchaseQuantity: 1;
  /** The seller's listed stock, shown separately from the purchase quantity. */
  inventory: number;
}

export type OrderPreviewResult = { ok: true; preview: OrderPreview } | { ok: false; error: OrderActionError };
export type OrderCopyResult = { ok: true } | { ok: false; error: OrderActionError };

export interface MarketQueryResultEnvelope {
  snapshotId: string | null;
  result: MarketQueryResult;
}

export interface WhisperTextInput {
  seller: string;
  itemName: string;
  rank: number;
  platinum: number;
}

/** The exact text offered to the user for preview and written on copy (including the /w target). */
export function buildWhisperText(input: WhisperTextInput): string {
  return `/w ${input.seller} Hi! I want to buy: "${input.itemName} (rank ${input.rank})" for ${input.platinum} platinum. (warframe.market)`;
}

function expiredError(): OrderActionError {
  return { code: 'EXPIRED', message: '行情快照已过期，请刷新后重新选择订单。' };
}

function snapshotNotFoundError(): OrderActionError {
  return { code: 'SNAPSHOT_NOT_FOUND', message: '行情快照不可用，请刷新后再试。' };
}

function orderUnavailableError(): OrderActionError {
  return { code: 'ORDER_UNAVAILABLE', message: '所选订单不可用，请重新选择。' };
}

/**
 * A snapshot may drive preview/copy only while it is fresh and its expiry is
 * still ahead. An unparseable expiry time and stale evidence are both treated
 * as not usable: the renderer only sees the same EXPIRED refusal plus its own
 * refresh entry, so an invalid time can never be converted into a valid action.
 */
function snapshotExpired(result: MarketQuerySuccess, nowMs: number): boolean {
  const expiresAt = Date.parse(result.evidence.expiresAt);
  const past = Number.isFinite(expiresAt) ? expiresAt <= nowMs : true;
  return result.evidence.freshness !== 'fresh' || past;
}

type ResolvedOrder =
  | { result: MarketQuerySuccess; order: MarketOrder }
  | { error: OrderActionError };

function resolveSellOrder(entry: MarketSnapshotEntry | undefined, input: OrderActionRequest, nowMs: number): ResolvedOrder {
  if (!entry || !entry.result.ok) return { error: snapshotNotFoundError() };
  if (snapshotExpired(entry.result, nowMs)) return { error: expiredError() };
  const order = entry.result.data.sellOrders[input.orderIndex];
  if (!order) return { error: orderUnavailableError() };
  return { result: entry.result, order };
}

/** Preview/copy payload derived from the trusted snapshot only. */
function buildPreview(result: MarketQuerySuccess, order: MarketOrder): OrderPreview {
  const itemName = result.data.item.name.en;
  const itemRank = result.data.item.rank.resolved;
  const text = buildWhisperText({
    seller: order.ingameName,
    itemName,
    rank: itemRank,
    platinum: order.platinum,
  });
  return {
    text,
    itemName,
    itemRank,
    seller: order.ingameName,
    sellerStatus: order.status,
    sellerPlatform: order.platform,
    platinum: order.platinum,
    purchaseQuantity: 1,
    inventory: order.quantity,
  };
}

export function presetOrderPreview(
  registry: MarketSnapshotRegistry,
  input: unknown,
  now = Date.now(),
): OrderPreviewResult {
  if (!validOrderActionRequest(input)) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: '预览请求无效。' } };
  }
  const resolved = resolveSellOrder(registry.get(input.snapshotId), input, now);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  return { ok: true, preview: buildPreview(resolved.result, resolved.order) };
}

export function performOrderCopy(
  registry: MarketSnapshotRegistry,
  input: unknown,
  now = Date.now(),
  writeClipboard: (text: string) => void,
): OrderCopyResult {
  if (!validOrderActionRequest(input)) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: '复制请求无效。' } };
  }
  const resolved = resolveSellOrder(registry.get(input.snapshotId), input, now);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  const preview = buildPreview(resolved.result, resolved.order);
  try {
    writeClipboard(preview.text);
    return { ok: true };
  } catch {
    return { ok: false, error: { code: 'CLIPBOARD_FAILED', message: '无法写入剪贴板，请稍后重试。' } };
  }
}
