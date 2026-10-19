import { describe, expect, it } from 'vitest';
import {
  formatPlatinum,
  marketDeviationLabel,
  marketEffectLines,
  marketItemImageUrl,
  marketRankLabel,
  marketSetSummaryText,
  parseRankInput,
} from '../src/renderer/market-presentation.js';

describe('desktop market presentation', () => {
  it('parses explicit ranks without accepting ambiguous input', () => {
    expect(parseRankInput('0')).toBe(0);
    expect(parseRankInput('  MAX ')).toBe('max');
    expect(parseRankInput('-1')).toBeNull();
    expect(parseRankInput('1.5')).toBeNull();
    expect(parseRankInput('')).toBeNull();
  });

  it('labels platinum values for the native card', () => {
    expect(formatPlatinum(12.5)).toBe('12.5 白金');
  });

  it('shows no level requirement for non-upgradable items and resolves max by metadata', () => {
    expect(marketRankLabel(0, 0)).toBe('无需等级');
    expect(marketRankLabel('max', 0)).toBe('无需等级');
    expect(marketRankLabel(0, 3)).toBe('等级 0');
    expect(marketRankLabel('max', 3)).toBe('满级');
    expect(marketRankLabel(5, 10)).toBe('等级 5');
  });

  it('picks the legacy full icon first, then subIcon/thumb; null stays null', () => {
    expect(marketItemImageUrl(null)).toBeNull();
    expect(marketItemImageUrl({ thumb: null, icon: null, subIcon: null })).toBeNull();
    expect(marketItemImageUrl({
      thumb: 'https://warframe.market/static/assets/thumb.png',
      icon: 'https://warframe.market/static/assets/icon.png',
      subIcon: 'https://warframe.market/static/assets/sub.png',
    })).toBe('https://warframe.market/static/assets/icon.png');
    expect(marketItemImageUrl({
      thumb: null,
      icon: 'https://warframe.market/static/assets/icon.png',
      subIcon: null,
    })).toBe('https://warframe.market/static/assets/icon.png');
  });

  it('derives MOD/arcane effect lines only for mod/arcane items and when text exists', () => {
    expect(marketEffectLines(['prime'], '+50 能量')).toEqual([]);
    expect(marketEffectLines(['mod'], null)).toEqual([]);
    expect(marketEffectLines(['mod'], '+50 能量\n+100 血量')).toEqual(['+50 能量', '+100 血量']);
    expect(marketEffectLines(['arcane_enhancement'], '恢复能量。提升伤害。额外说明。')).toEqual(['恢复能量', '提升伤害', '额外说明']);
    // Sentence-split only when no +/- lines exist; trailing punctuation is dropped.
    expect(marketEffectLines(['arcane_enhancement'], '第一条；第二条。')).toEqual(['第一条', '第二条']);
    // At most four lines.
    expect(marketEffectLines(['arcane_enhancement'], Array.from({ length: 6 }, (_, index) => `效果${index + 1}。`).join(''))).toHaveLength(4);
  });

  it('labels the current-vs-history deviation with the legacy ±5% threshold', () => {
    expect(marketDeviationLabel(null)).toBe('无法计算');
    expect(marketDeviationLabel(0)).toBe('与 90 日中位持平');
    expect(marketDeviationLabel(3)).toBe('与 90 日中位持平');
    expect(marketDeviationLabel(20)).toBe('高 20%');
    expect(marketDeviationLabel(-9)).toBe('低 9%');
  });

  it('summarizes set vs components with an explicit missing-quote note and never invents a total', () => {
    expect(marketSetSummaryText({
      root: true,
      components: [],
      componentsTotal: null, pricedCount: 0, missingCount: 0, setLowest: 45,
    })).toBe('散件均无在线报价');
    expect(marketSetSummaryText({
      root: true,
      components: [],
      componentsTotal: 31, pricedCount: 3, missingCount: 1, setLowest: 45,
    })).toBe('散件合计 ≈ 31 白金（缺 1 件报价） · 整套最低 45 白金');
    expect(marketSetSummaryText({
      root: true,
      components: [],
      componentsTotal: 31, pricedCount: 3, missingCount: 0, setLowest: null,
    })).toBe('散件合计 ≈ 31 白金');
  });
});
