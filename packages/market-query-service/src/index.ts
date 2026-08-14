import {
  MARKET_PLATFORMS,
  MARKET_QUERY_CONTRACT_VERSION,
  MarketContractViolation,
  assertMarketQueryRequest,
  assertMarketQueryResult,
  type ClosedTradeStatistics,
  type MarketEvidence,
  type MarketOrder,
  type MarketOrderSide,
  type MarketPlatform,
  type MarketQueryErrorCode,
  type MarketQueryFailure,
  type MarketQueryRequest,
  type MarketQueryResult,
  type MarketQuerySuccess,
  type MarketWarning,
} from '@warframe-companion/market-query-contract';
import { resolveMarketItem, type MarketCatalogItem } from './item-resolver.js';

const DEFAULT_BASE_URL = 'https://api.warframe.market';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_EVIDENCE_TTL_MS = 5 * 60_000;
const DEFAULT_ORDER_LIMIT = 5;

export type MarketFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface WarframeMarketQueryServiceOptions {
  fetch?: MarketFetch;
  now?: () => Date;
  baseUrl?: string;
  timeoutMs?: number;
  evidenceTtlMs?: number;
  orderLimit?: number;
}

class UpstreamFailure extends Error {
  constructor(
    readonly code: Extract<MarketQueryErrorCode, `UPSTREAM_${string}`>,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'UpstreamFailure';
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = nonNegativeNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function retryAfterMilliseconds(value: string | null, now: Date): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now.getTime());
  return undefined;
}

function evidence(now: Date, ttlMs: number, finding: MarketEvidence['finding']): MarketEvidence {
  return {
    scope: 'current_market',
    evidenceType: 'direct_snapshot',
    asOf: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    freshness: 'fresh',
    finding,
    source: 'warframe.market',
  };
}

function validationFailure(input: unknown, violation: MarketContractViolation): MarketQueryFailure {
  const request = object(input);
  const platform = request?.platform;
  const rank = request?.rank;
  if (platform !== undefined && !MARKET_PLATFORMS.includes(platform as MarketPlatform)) {
    return failure('UNSUPPORTED_PLATFORM', '平台不受支持。', { field: 'platform' });
  }
  if (rank !== undefined && rank !== 'max'
    && (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0)) {
    return failure('INVALID_RANK', '等级必须是非负整数或 max。', { field: 'rank' });
  }
  const fieldMatch = violation.path.match(/^\$\.([^.[\]]+)/u);
  const field = fieldMatch?.[1];
  const allowed = ['contractVersion', 'item', 'platform', 'crossplay', 'rank'] as const;
  const details = allowed.includes(field as (typeof allowed)[number])
    ? { field: field as (typeof allowed)[number] }
    : undefined;
  return failure('INVALID_REQUEST', '市场查询请求无效。', details);
}

const CATEGORY_BY_CODE = {
  INVALID_REQUEST: 'validation', UNSUPPORTED_PLATFORM: 'validation', INVALID_RANK: 'validation',
  ITEM_NOT_FOUND: 'resolution', ITEM_AMBIGUOUS: 'resolution',
  UPSTREAM_UNAVAILABLE: 'upstream', UPSTREAM_TIMEOUT: 'upstream',
  UPSTREAM_RATE_LIMITED: 'upstream', UPSTREAM_BAD_RESPONSE: 'upstream',
  INTERNAL_ERROR: 'internal',
} as const;

const RETRYABLE = new Set<MarketQueryErrorCode>([
  'UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_RATE_LIMITED',
]);

function failure(
  code: MarketQueryErrorCode,
  message: string,
  details?: MarketQueryFailure['error']['details'],
  unavailableEvidence?: MarketEvidence,
): MarketQueryFailure {
  return {
    contractVersion: MARKET_QUERY_CONTRACT_VERSION,
    ok: false,
    error: {
      category: CATEGORY_BY_CODE[code],
      code,
      message,
      retryable: RETRYABLE.has(code),
      ...(details ? { details } : {}),
    },
    ...(unavailableEvidence ? { evidence: unavailableEvidence } : {}),
  };
}

function upstreamMessage(code: UpstreamFailure['code']): string {
  switch (code) {
    case 'UPSTREAM_TIMEOUT': return 'Warframe.Market 响应超时。';
    case 'UPSTREAM_RATE_LIMITED': return 'Warframe.Market 请求过于频繁。';
    case 'UPSTREAM_BAD_RESPONSE': return 'Warframe.Market 返回了无法解析的数据。';
    case 'UPSTREAM_UNAVAILABLE': return 'Warframe.Market 暂时不可用。';
  }
}

function parseCatalog(payload: unknown): MarketCatalogItem[] {
  const data = object(payload)?.data;
  if (!Array.isArray(data) || data.length === 0) throw new UpstreamFailure('UPSTREAM_BAD_RESPONSE');
  return data.map((entry) => {
    const item = object(entry);
    const i18n = object(item?.i18n);
    const en = object(i18n?.en)?.name;
    const zhHans = object(i18n?.['zh-hans'])?.name;
    const slug = item?.slug;
    const tags = item?.tags;
    if (typeof slug !== 'string' || !slug || typeof en !== 'string' || !en
      || typeof zhHans !== 'string' || !zhHans || !Array.isArray(tags)
      || tags.some((tag) => typeof tag !== 'string')) {
      throw new UpstreamFailure('UPSTREAM_BAD_RESPONSE');
    }
    return { slug, name: { en, zhHans }, tags: [...tags] as string[] };
  });
}

interface ParsedDetail {
  name: MarketCatalogItem['name'];
  tags: string[];
  maxRank: number;
  ducats: number | null;
  tradingTax: number | null;
  masteryRank: number | null;
}

function nullableNonNegative(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = nonNegativeNumber(value);
  if (parsed === null) throw new UpstreamFailure('UPSTREAM_BAD_RESPONSE');
  return parsed;
}

function parseDetail(payload: unknown, catalogItem: MarketCatalogItem): ParsedDetail {
  const data = object(object(payload)?.data);
  if (!data) throw new UpstreamFailure('UPSTREAM_BAD_RESPONSE');
  const i18n = object(data.i18n);
  const en = object(i18n?.en)?.name ?? catalogItem.name.en;
  const zhHans = object(i18n?.['zh-hans'])?.name ?? catalogItem.name.zhHans;
  const tags = data.tags ?? catalogItem.tags;
  if (typeof en !== 'string' || !en || typeof zhHans !== 'string' || !zhHans
    || !Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
    throw new UpstreamFailure('UPSTREAM_BAD_RESPONSE');
  }
  const rawMaxRank = data.maxRank;
  const maxRank = rawMaxRank === undefined || rawMaxRank === null ? 0 : nonNegativeInteger(rawMaxRank);
  if (maxRank === null) throw new UpstreamFailure('UPSTREAM_BAD_RESPONSE');
  return {
    name: { en, zhHans },
    tags: [...tags] as string[],
    maxRank,
    ducats: nullableNonNegative(data.ducats),
    tradingTax: nullableNonNegative(data.tradingTax),
    masteryRank: nullableNonNegative(data.reqMasteryRank),
  };
}

function triangularCopies(rank: number): number {
  return ((rank + 1) * (rank + 2)) / 2;
}

function tradingTaxForRank(detail: ParsedDetail, rank: number): number | null {
  if (detail.tradingTax === null || detail.maxRank === 0
    || !detail.tags.includes('arcane_enhancement') || !detail.tags.includes('legendary')) {
    return detail.tradingTax;
  }
  return Math.round((detail.tradingTax / triangularCopies(detail.maxRank)) * triangularCopies(rank));
}

function parseOrder(entry: unknown, side: MarketOrderSide): MarketOrder {
  const order = object(entry);
  const user = object(order?.user);
  const platinum = nonNegativeNumber(order?.platinum);
  const quantity = nonNegativeInteger(order?.quantity);
  const ingameName = user?.ingameName;
  const platform = user?.platform;
  const updatedAt = normalizeIso(order?.updatedAt);
  const rank = order?.rank === undefined || order.rank === null ? null : nonNegativeInteger(order.rank);
  if (!order || platinum === null || quantity === null || quantity < 1
    || typeof ingameName !== 'string' || !ingameName || !MARKET_PLATFORMS.includes(platform as MarketPlatform)
    || updatedAt === null || (order.rank !== undefined && order.rank !== null && rank === null)) {
    throw new UpstreamFailure('UPSTREAM_BAD_RESPONSE');
  }
  const rawStatus = user?.status;
  const status = rawStatus === 'ingame' || rawStatus === 'online' || rawStatus === 'offline' ? rawStatus : 'unknown';
  const rawCrossplay = user?.crossplay;
  const crossplay = typeof rawCrossplay === 'boolean' ? rawCrossplay : null;
  return {
    side,
    platinum,
    quantity,
    ingameName,
    status,
    platform: platform as MarketPlatform,
    crossplay,
    rank,
    updatedAt,
  };
}

function parseOrders(payload: unknown, limit: number): { sellOrders: MarketOrder[]; buyOrders: MarketOrder[] } {
  const data = object(object(payload)?.data);
  if (!data || !Array.isArray(data.sell) || !Array.isArray(data.buy)) {
    throw new UpstreamFailure('UPSTREAM_BAD_RESPONSE');
  }
  const visible = (entry: unknown): boolean => object(entry)?.visible !== false;
  const sellOrders = data.sell.filter(visible).map((entry) => parseOrder(entry, 'sell'))
    .sort((a, b) => a.platinum - b.platinum).slice(0, limit);
  const buyOrders = data.buy.filter(visible).map((entry) => parseOrder(entry, 'buy'))
    .sort((a, b) => b.platinum - a.platinum).slice(0, limit);
  return { sellOrders, buyOrders };
}

function parseStatistics(payload: unknown, rank: number, ranked: boolean): ClosedTradeStatistics | undefined {
  const closed = object(object(object(payload)?.payload)?.statistics_closed)?.['90days'];
  if (!Array.isArray(closed)) return undefined;
  const rows = closed.map((entry) => object(entry)).filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => ranked ? entry.mod_rank === rank : entry.mod_rank === undefined || entry.mod_rank === null || entry.mod_rank === 0)
    .map((entry) => ({
      median: nonNegativeNumber(entry.median),
      volume: nonNegativeNumber(entry.volume),
      at: normalizeIso(entry.datetime),
    })).filter((entry): entry is { median: number; volume: number; at: string } =>
      entry.median !== null && entry.volume !== null && entry.at !== null);
  if (rows.length < 3) return undefined;
  const medians = rows.map((row) => row.median).sort((a, b) => a - b);
  const sampleSize = Math.round(rows.reduce((sum, row) => sum + row.volume, 0));
  const asOf = rows.map((row) => row.at).sort().at(-1)!;
  return {
    basis: 'closed_trades_90_days',
    median: Math.round(medians[Math.floor(medians.length / 2)]! * 10) / 10,
    dailyVolume: Math.round((sampleSize / rows.length) * 10) / 10,
    sampleSize,
    rank,
    asOf,
  };
}

export class WarframeMarketQueryService {
  readonly #fetch: MarketFetch;
  readonly #now: () => Date;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #evidenceTtlMs: number;
  readonly #orderLimit: number;

  constructor(options: WarframeMarketQueryServiceOptions = {}) {
    this.#fetch = options.fetch ?? (globalThis.fetch as MarketFetch);
    this.#now = options.now ?? (() => new Date());
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/u, '');
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#evidenceTtlMs = options.evidenceTtlMs ?? DEFAULT_EVIDENCE_TTL_MS;
    this.#orderLimit = options.orderLimit ?? DEFAULT_ORDER_LIMIT;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1
      || !Number.isInteger(this.#evidenceTtlMs) || this.#evidenceTtlMs < 1
      || !Number.isInteger(this.#orderLimit) || this.#orderLimit < 1) {
      throw new TypeError('timeoutMs、evidenceTtlMs 和 orderLimit 必须是正整数');
    }
  }

  async #json(path: string, request: MarketQueryRequest): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        headers: {
          Accept: 'application/json',
          Platform: request.platform,
          Crossplay: String(request.crossplay),
          Language: 'zh-hans',
        },
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new UpstreamFailure(
          'UPSTREAM_RATE_LIMITED',
          retryAfterMilliseconds(response.headers.get('retry-after'), this.#now()),
        );
      }
      if (!response.ok) {
        throw new UpstreamFailure(response.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_BAD_RESPONSE');
      }
      try {
        return await response.json();
      } catch {
        throw new UpstreamFailure('UPSTREAM_BAD_RESPONSE');
      }
    } catch (error) {
      if (error instanceof UpstreamFailure) throw error;
      if (controller.signal.aborted || (object(error)?.name === 'AbortError')) {
        throw new UpstreamFailure('UPSTREAM_TIMEOUT');
      }
      throw new UpstreamFailure('UPSTREAM_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  async query(input: unknown): Promise<MarketQueryResult> {
    try {
      assertMarketQueryRequest(input);
    } catch (error) {
      if (error instanceof MarketContractViolation) return validationFailure(input, error);
      return failure('INVALID_REQUEST', '市场查询请求无效。');
    }
    const request = input;
    try {
      const catalog = parseCatalog(await this.#json('/v2/items', request));
      const resolution = resolveMarketItem(catalog, request.item);
      if (!resolution.match) {
        if (resolution.candidates.length === 0) return failure('ITEM_NOT_FOUND', '没有找到匹配物品。');
        return failure('ITEM_AMBIGUOUS', '物品名称对应多个候选项。', {
          candidates: resolution.candidates.map((candidate) => ({ slug: candidate.slug, name: candidate.name })),
        });
      }

      const detail = parseDetail(
        await this.#json(`/v2/item/${encodeURIComponent(resolution.match.slug)}`, request),
        resolution.match,
      );
      const resolvedRank = request.rank === 'max' ? detail.maxRank : request.rank;
      if (resolvedRank > detail.maxRank) {
        return failure('INVALID_RANK', `等级超出物品范围（最高 ${detail.maxRank} 级）。`, { field: 'rank' });
      }
      const rankQuery = detail.maxRank > 0 ? `?rank=${encodeURIComponent(resolvedRank)}` : '';
      const ordersPromise = this.#json(`/v2/orders/item/${encodeURIComponent(resolution.match.slug)}/top${rankQuery}`, request);
      const statisticsPromise = this.#json(`/v1/items/${encodeURIComponent(resolution.match.slug)}/statistics`, request)
        .then((payload) => parseStatistics(payload, resolvedRank, detail.maxRank > 0))
        .catch(() => undefined);
      const orders = parseOrders(await ordersPromise, this.#orderLimit);
      const statistics = await statisticsPromise;
      const warnings: MarketWarning[] = [];
      if (orders.sellOrders.length === 0) warnings.push({ code: 'NO_SELL_ORDERS', message: '本次快照没有可见卖单。' });
      if (orders.buyOrders.length === 0) warnings.push({ code: 'NO_BUY_ORDERS', message: '本次快照没有可见买单。' });
      if (!statistics) warnings.push({ code: 'STATISTICS_UNAVAILABLE', message: '90 天成交统计不可用，当前订单查询仍然成功。' });
      const snapshotTime = this.#now();
      const result: MarketQuerySuccess = {
        contractVersion: MARKET_QUERY_CONTRACT_VERSION,
        ok: true,
        data: {
          requestedItem: request.item,
          item: {
            slug: resolution.match.slug,
            name: detail.name,
            tags: detail.tags,
            rank: { requested: request.rank, resolved: resolvedRank, maxRank: detail.maxRank },
            ducats: detail.ducats,
            tradingTax: tradingTaxForRank(detail, resolvedRank),
            masteryRank: detail.masteryRank,
          },
          sellOrders: orders.sellOrders,
          buyOrders: orders.buyOrders,
          ...(statistics ? { statistics } : {}),
        },
        evidence: evidence(
          snapshotTime,
          this.#evidenceTtlMs,
          orders.sellOrders.length === 0 && orders.buyOrders.length === 0
            ? 'confirmed_absent_in_scope'
            : 'confirmed_present',
        ),
        warnings,
      };
      assertMarketQueryResult(result);
      return result;
    } catch (error) {
      if (error instanceof UpstreamFailure) {
        const snapshotTime = this.#now();
        return failure(
          error.code,
          upstreamMessage(error.code),
          error.retryAfterMs === undefined ? undefined : { retryAfterMs: error.retryAfterMs },
          evidence(snapshotTime, this.#evidenceTtlMs, 'unavailable'),
        );
      }
      return failure('INTERNAL_ERROR', '市场查询内部失败。');
    }
  }
}

export function createWarframeMarketQueryService(
  options: WarframeMarketQueryServiceOptions = {},
): WarframeMarketQueryService {
  return new WarframeMarketQueryService(options);
}

export { expandMarketItemQuery, resolveMarketItem } from './item-resolver.js';
