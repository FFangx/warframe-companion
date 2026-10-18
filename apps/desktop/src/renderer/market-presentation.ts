import type {
  MarketItemImage,
  MarketPlatform,
  MarketQueryErrorCategory,
  MarketRank,
  MarketSetComparison,
  MarketUserStatus,
} from '@warframe-companion/market-query-contract';

export const PLATFORM_LABELS: Record<MarketPlatform, string> = {
  pc: 'PC',
  ps4: 'PlayStation',
  xbox: 'Xbox',
  switch: 'Nintendo Switch',
  mobile: '移动端',
};

export const STATUS_LABELS: Record<MarketUserStatus, string> = {
  ingame: '游戏中',
  online: '在线',
  offline: '离线',
  unknown: '状态未知',
};

export const ERROR_CATEGORY_LABELS: Record<MarketQueryErrorCategory, string> = {
  validation: '查询条件有误',
  resolution: '物品解析失败',
  upstream: '市场数据源不可用',
  internal: '桌面查询失败',
};

export function parseRankInput(value: string): number | 'max' | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'max') return 'max';
  if (!/^\d+$/u.test(normalized)) return null;
  const rank = Number(normalized);
  return Number.isSafeInteger(rank) ? rank : null;
}

/**
 * 等级展示规则：maxRank=0（套装/部件等不可升级条目）显示“无需等级”，
 * 不要求玩家提供等级；可升级条目的“满级”按物品元数据求值。
 */
export function marketRankLabel(rank: MarketRank, maxRank: number): string {
  if (maxRank <= 0) return '无需等级';
  if (rank === 'max') return '满级';
  return `等级 ${rank}`;
}

export function formatPlatinum(value: number): string {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)} 白金`;
}

export function formatCredits(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);
}

/**
 * Display image for the card: the legacy template uses the full item icon
 * first (notably the bordered MOD card), then falls back to subIcon/thumb.
 * The service already dropped known placeholder assets, so any non-null URL is
 * a real bounded warframe.market asset URL validated by the contract.
 */
export function marketItemImageUrl(image: MarketItemImage | null): string | null {
  return image ? image.icon ?? image.subIcon ?? image.thumb : null;
}

/**
 * MOD/arcane effect lines from the localized description (legacy behavior):
 * prefer lines that start with +/-; otherwise split sentences on 。/； and keep
 * at most 4 lines. Non-MOD/arcane items never show an effects row.
 */
export function marketEffectLines(tags: string[], description: string | null): string[] {
  if (!description || !tags.some((tag) => tag === 'mod' || tag === 'arcane_enhancement')) return [];
  const lines = description.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const plusLines = lines.filter((line) => /^[+-]/u.test(line));
  return (plusLines.length ? plusLines : lines.flatMap((line) => line.split(/(?<=[。；])/u)))
    .map((part) => part.trim().replace(/[。；]$/u, ''))
    .filter(Boolean)
    .slice(0, 4);
}

/** Legacy threshold: |deviation| < 5% reads as in line with history. */
export function marketDeviationLabel(deviationPct: number | null): string {
  if (deviationPct === null) return '无法计算';
  if (Math.abs(deviationPct) < 5) return '与 90 日中位持平';
  return deviationPct > 0 ? `高 ${deviationPct}%` : `低 ${Math.abs(deviationPct)}%`;
}

/**
 * Set-vs-components summary. The total covers priced components only and the
 * note makes missing quotes explicit; with no quote at all it says so instead
 * of inventing a total.
 */
export function marketSetSummaryText(set: MarketSetComparison): string {
  if (set.pricedCount === 0) return '散件均无在线报价';
  const missing = set.missingCount > 0 ? `（缺 ${set.missingCount} 件报价）` : '';
  const setLine = set.setLowest != null ? ` · 整套最低 ${formatPlatinum(set.setLowest)}` : '';
  return `散件合计 ≈ ${formatPlatinum(set.componentsTotal ?? 0)}${missing}${setLine}`;
}
