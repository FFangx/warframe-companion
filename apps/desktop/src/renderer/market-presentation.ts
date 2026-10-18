import type {
  MarketPlatform,
  MarketQueryErrorCategory,
  MarketRank,
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
