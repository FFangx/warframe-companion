import { describe, expect, it } from 'vitest';
import { formatPlatinum, marketRankLabel, parseRankInput } from '../src/renderer/market-presentation.js';

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
});
