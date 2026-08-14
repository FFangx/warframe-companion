import type { ResolvedMarketItem } from '@warframe-companion/market-query-contract';

export interface MarketCatalogItem {
  slug: string;
  name: ResolvedMarketItem['name'];
  tags: string[];
}

export interface MarketItemResolution {
  match?: MarketCatalogItem;
  candidates: MarketCatalogItem[];
}

const ITEM_ALIASES: Readonly<Record<string, string>> = {
  悟空: 'wukong', 猴子: 'wukong', 猴哥: 'wukong',
  奶妈: 'trinity', 电男: 'volt', 伏特: 'volt', 冰男: 'frost',
  火女: 'ember', 毒妈: 'saryn', 牛牛: 'rhino', 犀牛: 'rhino',
  女枪: 'mesa', 高斯: 'gauss', 夜灵: 'revenant', 血妈: 'garuda',
  猫甲: 'khora', 玻璃甲: 'gara', 龙甲: 'chroma', 磁力: 'mag',
  圣剑: 'excalibur', 洛基: 'loki', 摸尸: 'nekros', 水男: 'hydroid',
  鸟姐: 'zephyr', 小明: 'limbo', 小丑: 'mirage', 妮瓦: 'nova',
  诺娃: 'nova', 音甲: 'octavia', 瓦喵: 'valkyr', 女武神: 'valkyr',
  蛆甲: 'nidus', 哪吒: 'nezha', 沙甲: 'inaros', 妖精: 'titania',
  工程甲: 'vauban', 剑圣: 'ash', 龙王: 'oberon', 扶她: 'equinox',
  弓妹: 'ivara', 鬼甲: 'sevagoth', 狼妹: 'voruna', 花甲: 'wisp',
  茶妹: 'protea', 电妹: 'gyre', 刀哥: 'kullervo', 但丁: 'dante',
  捷德: 'jade', 和尚: 'baruuk', 石甲: 'atlas', 水妹: 'yareli',
  蛇甲: 'lavos', 斯巴达: 'styanax', 水晶甲: 'citrine', 主教: 'harrow',
  战刃: 'glaive', 盘子: 'glaive', 毒盘子: 'cerata', 鱼骨: 'boltor',
  充沛: 'arcane energize', 充沛赋能: 'arcane energize', 速攻: 'arcane strike',
};

const COMPONENT_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/头部神经光元|神经光元|头部|头盔|头$/gu, ' neuroptics blueprint'],
  [/机体/gu, ' chassis blueprint'],
  [/系统/gu, ' systems blueprint'],
  [/枪机/gu, ' receiver'],
  [/枪托/gu, ' stock'],
  [/握柄|手柄/gu, ' handle'],
  [/刀刃/gu, ' blade'],
  [/蓝图/gu, ' blueprint'],
];

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function compact(value: string): string {
  return normalize(value).toLowerCase().replace(/[\s_\-:：·•]+/gu, '');
}

export function expandMarketItemQuery(value: string): string {
  let expanded = normalize(value).toLowerCase();
  for (const [alias, canonical] of Object.entries(ITEM_ALIASES).sort((a, b) => b[0].length - a[0].length)) {
    expanded = expanded.split(alias).join(canonical);
  }
  expanded = expanded.replace(/一套|套装/gu, ' set');
  expanded = expanded.replace(/([\p{L}\p{N}])p(?=$|[\u4e00-\u9fff])/giu, '$1 prime ');
  expanded = expanded.replace(/(^|\s)p(?=\s|$)/giu, '$1prime');
  for (const [pattern, replacement] of COMPONENT_ALIASES) expanded = expanded.replace(pattern, replacement);
  return normalize(expanded);
}

function fields(item: MarketCatalogItem): string[] {
  return [compact(item.slug), compact(item.name.en), compact(item.name.zhHans)];
}

function unique(items: MarketCatalogItem[]): MarketCatalogItem[] {
  return [...new Map(items.map((item) => [item.slug, item])).values()];
}

function distance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const matrix = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i]![j] = Math.min(matrix[i]![j]!, matrix[i - 2]![j - 2]! + 1);
      }
    }
  }
  return matrix[a.length]![b.length]!;
}

function typoThreshold(length: number): number {
  if (length <= 1) return 0;
  if (length <= 4) return 1;
  if (length <= 9) return 2;
  return Math.min(4, Math.floor(length * 0.2));
}

export function resolveMarketItem(items: MarketCatalogItem[], rawQuery: string): MarketItemResolution {
  const expanded = expandMarketItemQuery(rawQuery);
  const query = compact(expanded);
  const explicitComponent = /(neuroptics|chassis|systems|blueprint|receiver|stock|handle|blade)/iu.test(expanded);
  const primeQuery = query.includes('prime');

  if (primeQuery && !explicitComponent && !query.endsWith('set')) {
    const base = query.replace(/prime$/u, '').replace(/set$/u, '');
    const preferred = items.find((item) => item.slug === `${base}_prime_set`);
    if (preferred) return { match: preferred, candidates: [] };
  }

  const exact = unique(items.filter((item) => fields(item).includes(query)));
  if (exact.length === 1) return { match: exact[0]!, candidates: [] };
  if (exact.length > 1) return { candidates: exact.slice(0, 8) };

  const rawQueryCompact = compact(rawQuery);
  if (rawQueryCompact !== query) {
    const rawExact = unique(items.filter((item) => fields(item).includes(rawQueryCompact)));
    if (rawExact.length === 1) return { match: rawExact[0]!, candidates: [] };
  }

  const partial = unique(items.filter((item) => fields(item).some((field) => field.includes(query) || query.includes(field))));
  if (primeQuery && !explicitComponent) {
    const sets = partial.filter((item) => item.slug.endsWith('_prime_set'));
    if (sets.length === 1) return { match: sets[0]!, candidates: [] };
  }
  if (partial.length === 1) return { match: partial[0]!, candidates: [] };
  if (partial.length > 1) return { candidates: partial.slice(0, 8) };

  // “赋能”常被当作类别前缀使用，但部分官方名称本身也含该词；先按原文查询，
  // 只有完全未命中时才剥离后重试，保持与现有 QQ 适配器一致。
  if (rawQuery.includes('赋能')) {
    const stripped = normalize(rawQuery.replace(/赋能/gu, ' '));
    if (stripped && compact(stripped) !== query) return resolveMarketItem(items, stripped);
  }

  const ranked = items.map((item) => ({
    item,
    distance: Math.min(...fields(item).map((field) => distance(query, field))),
  })).sort((a, b) => a.distance - b.distance || a.item.slug.localeCompare(b.item.slug));
  const best = ranked[0];
  const second = ranked[1];
  if (best && best.distance <= typoThreshold(Math.max(query.length, compact(best.item.slug).length))
    && (!second || second.distance > best.distance)) {
    return { match: best.item, candidates: [] };
  }
  if (best && best.distance <= typoThreshold(query.length) + 1) {
    return { candidates: ranked.filter((entry) => entry.distance <= best.distance + 1).slice(0, 8).map((entry) => entry.item) };
  }
  return { candidates: [] };
}
