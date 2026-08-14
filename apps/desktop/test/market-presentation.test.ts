import { describe, expect, it } from 'vitest';
import { formatPlatinum, parseRankInput } from '../src/renderer/market-presentation.js';

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
});
