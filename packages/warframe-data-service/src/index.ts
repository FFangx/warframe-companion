import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DROP_ALIAS_ENTRIES,
  DROP_ALIAS_LICENSE,
  DROP_ALIAS_SOURCE,
} from './drop-aliases.js';
export { DROP_ALIAS_ENTRIES, DROP_ALIAS_LICENSE, DROP_ALIAS_SOURCE } from './drop-aliases.js';

export const DROP_SEARCH_CONTRACT_VERSION = '1.1' as const;
const SNAPSHOT_SCHEMA_VERSION = 2 as const;
// The public site currently challenges Node/Electron clients with a 403. jsDelivr
// serves the same WFCD gh-pages snapshot without browser impersonation.
const DEFAULT_BASE_URL = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-drop-data@gh-pages/data';
const DEFAULT_ALTERNATIVE_BASE_URL = 'https://raw.githubusercontent.com/WFCD/warframe-drop-data/gh-pages/data';
const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_SOURCE_AGE_WARNING_MS = 30 * 24 * 60 * 60_000;
const DEFAULT_MAX_SOURCE_AGE_MS = 90 * 24 * 60 * 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_LIMIT = 20;

export interface DropSearchRequest {
  contractVersion: typeof DROP_SEARCH_CONTRACT_VERSION;
  item: string;
  limit?: number;
}
export interface DropLocation {
  place: string;
  chance: number;
  rarity: string;
}
export interface DropEvidence {
  scope: 'static_drop_table';
  evidenceType: 'versioned_public_snapshot';
  asOf: string;
  loadedAt: string;
  expiresAt: string;
  freshness: 'fresh' | 'stale';
  cacheFreshness: 'fresh' | 'stale';
  sourceAge: {
    ageMs: number;
    status: 'current' | 'aged' | 'rejected';
    warningAfterMs: number;
    rejectAfterMs: number;
  };
  finding: 'confirmed_present' | 'unavailable';
  source: 'wfcd.drop-data';
  sourceHash: string;
  selectedEndpoint: 'wfcd.jsdelivr' | 'wfcd.github-raw';
  alternativeComparison: {
    checkedAt: string;
    status: 'matched' | 'different' | 'primary_only' | 'alternative_only' | 'primary_payload_only' | 'alternative_payload_only' | 'not_configured';
    preferred: 'primary' | 'alternative';
    reason: 'same_hash' | 'newer_source' | 'hash_divergence' | 'only_available' | 'payload_fallback' | 'not_configured';
    primaryHash?: string;
    alternativeHash?: string;
    primaryModifiedAt?: string;
    alternativeModifiedAt?: string;
  };
}
export interface DropSearchSuccess {
  contractVersion: typeof DROP_SEARCH_CONTRACT_VERSION;
  ok: true;
  data: {
    requestedItem: string;
    resolvedItem: string;
    match: 'exact' | 'normalized_exact' | 'alias_exact';
    alias?: {
      matched: string;
      language: 'zh-Hans' | 'en';
      canonicalItem: string;
      source: typeof DROP_ALIAS_SOURCE;
      license: typeof DROP_ALIAS_LICENSE;
    };
    drops: DropLocation[];
    totalDrops: number;
  };
  evidence: DropEvidence;
  warnings: Array<{ code: 'STALE_SNAPSHOT' | 'SOURCE_DATA_AGED' | 'ALTERNATIVE_SOURCE_SELECTED' | 'SOURCE_MIRROR_DIVERGED' | 'ALTERNATIVE_SOURCE_UNAVAILABLE' | 'RESULT_TRUNCATED' | 'SOURCE_ROWS_DISCARDED'; message: string }>;
}
export type DropSearchErrorCode = 'INVALID_REQUEST' | 'ITEM_NOT_FOUND' | 'ITEM_AMBIGUOUS' | 'SOURCE_UNAVAILABLE' | 'SOURCE_TOO_OLD';
export interface DropSearchFailure {
  contractVersion: typeof DROP_SEARCH_CONTRACT_VERSION;
  ok: false;
  error: {
    code: DropSearchErrorCode;
    message: string;
    retryable: boolean;
    candidates?: string[];
  };
  evidence?: DropEvidence;
}
export type DropSearchResult = DropSearchSuccess | DropSearchFailure;

interface SourceInfo { hash: string; timestamp: number; modified: number }
type SourceEndpoint = 'wfcd.jsdelivr' | 'wfcd.github-raw';
type AlternativeComparison = DropEvidence['alternativeComparison'];
interface SourceDrop { place: string; item: string; rarity: string; chance: number }
interface SourceDropBatch { rows: SourceDrop[]; discardedRows: number }
interface DropSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  source: 'wfcd.drop-data';
  sourceHash: string;
  sourceModifiedAt: string;
  loadedAt: string;
  discardedRows: number;
  selectedEndpoint: SourceEndpoint;
  alternativeComparison: AlternativeComparison;
  items: Record<string, DropLocation[]>;
}
export type DataFetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface WarframeDataServiceOptions {
  cacheDirectory: string;
  fetch?: DataFetch;
  now?: () => Date;
  baseUrl?: string;
  alternativeBaseUrl?: string | false;
  ttlMs?: number;
  sourceAgeWarningMs?: number;
  maxSourceAgeMs?: number;
  timeoutMs?: number;
}

class SourceFailure extends Error {}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s_.·•:：'’"“”()（）\[\]{}\-/\\]+/gu, '');
}
function resolveAlias(query: string): DropSearchSuccess['data']['alias'] | undefined {
  const normalized = normalize(query);
  for (const entry of DROP_ALIAS_ENTRIES) {
    for (const [language, aliases] of [['zh-Hans', entry.zhHans], ['en', entry.en]] as const) {
      const matched = aliases.find((alias) => normalize(alias) === normalized);
      if (matched) return {
        matched, language, canonicalItem: entry.canonicalItem,
        source: DROP_ALIAS_SOURCE, license: DROP_ALIAS_LICENSE,
      };
    }
  }
  return undefined;
}
function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim();
}
function chance(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value.trim()) ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}
function parseInfo(value: unknown): SourceInfo {
  const data = record(value);
  if (!data || typeof data.hash !== 'string' || !data.hash
    || typeof data.timestamp !== 'number' || !Number.isFinite(data.timestamp)
    || typeof data.modified !== 'number' || !Number.isFinite(data.modified)) throw new SourceFailure('bad info');
  return { hash: data.hash, timestamp: data.timestamp, modified: data.modified };
}
function parseDrops(value: unknown): SourceDropBatch {
  if (!Array.isArray(value) || value.length === 0) throw new SourceFailure('bad drops');
  const rows: SourceDrop[] = [];
  let discardedRows = 0;
  for (const entry of value) {
    const row = record(entry);
    const parsedChance = chance(row?.chance);
    if (!row || typeof row.place !== 'string' || !row.place || typeof row.item !== 'string' || !row.item
      || typeof row.rarity !== 'string' || !row.rarity) throw new SourceFailure('bad drop row');
    if (parsedChance === null) { discardedRows += 1; continue; }
    rows.push({ place: stripMarkup(row.place), item: row.item.trim(), rarity: row.rarity.trim(), chance: parsedChance });
  }
  if (rows.length === 0) throw new SourceFailure('empty valid drops');
  return { rows, discardedRows };
}
function validIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function parseSnapshot(value: unknown): DropSnapshot {
  const data = record(value);
  const rawItems = record(data?.items);
  const comparison = record(data?.alternativeComparison);
  if (data?.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || data.source !== 'wfcd.drop-data'
    || typeof data.sourceHash !== 'string' || !data.sourceHash || !validIso(data.sourceModifiedAt)
    || !validIso(data.loadedAt) || !Number.isInteger(data.discardedRows) || Number(data.discardedRows) < 0
    || !['wfcd.jsdelivr', 'wfcd.github-raw'].includes(String(data.selectedEndpoint))
    || !comparison || !validIso(comparison.checkedAt)
    || !['matched', 'different', 'primary_only', 'alternative_only', 'primary_payload_only', 'alternative_payload_only', 'not_configured'].includes(String(comparison.status))
    || !['primary', 'alternative'].includes(String(comparison.preferred))
    || !['same_hash', 'newer_source', 'hash_divergence', 'only_available', 'payload_fallback', 'not_configured'].includes(String(comparison.reason))
    || (comparison.primaryHash !== undefined && typeof comparison.primaryHash !== 'string')
    || (comparison.alternativeHash !== undefined && typeof comparison.alternativeHash !== 'string')
    || (comparison.primaryModifiedAt !== undefined && !validIso(comparison.primaryModifiedAt))
    || (comparison.alternativeModifiedAt !== undefined && !validIso(comparison.alternativeModifiedAt))
    || !rawItems) throw new SourceFailure('bad cache');
  const items: Record<string, DropLocation[]> = {};
  for (const [item, rawDrops] of Object.entries(rawItems)) {
    if (!item || !Array.isArray(rawDrops)) throw new SourceFailure('bad cache item');
    items[item] = rawDrops.map((entry) => {
      const drop = record(entry);
      const parsedChance = chance(drop?.chance);
      if (!drop || typeof drop.place !== 'string' || !drop.place || typeof drop.rarity !== 'string'
        || !drop.rarity || parsedChance === null) throw new SourceFailure('bad cache drop');
      return { place: drop.place, rarity: drop.rarity, chance: parsedChance };
    });
  }
  if (Object.keys(items).length === 0) throw new SourceFailure('empty cache');
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION, source: 'wfcd.drop-data', sourceHash: data.sourceHash,
    sourceModifiedAt: data.sourceModifiedAt, loadedAt: data.loadedAt, discardedRows: Number(data.discardedRows), items,
    selectedEndpoint: data.selectedEndpoint as SourceEndpoint,
    alternativeComparison: comparison as unknown as AlternativeComparison,
  };
}
function compile(info: SourceInfo, batch: SourceDropBatch, loadedAt: Date, selectedEndpoint: SourceEndpoint, alternativeComparison: AlternativeComparison): DropSnapshot {
  const items: Record<string, DropLocation[]> = {};
  for (const row of batch.rows) (items[row.item] ??= []).push({ place: row.place, rarity: row.rarity, chance: row.chance });
  for (const drops of Object.values(items)) drops.sort((a, b) => b.chance - a.chance || a.place.localeCompare(b.place, 'en'));
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION, source: 'wfcd.drop-data', sourceHash: info.hash,
    sourceModifiedAt: new Date(info.modified).toISOString(), loadedAt: loadedAt.toISOString(),
    discardedRows: batch.discardedRows, selectedEndpoint, alternativeComparison, items,
  };
}
function failure(code: DropSearchErrorCode, message: string, candidates?: string[], evidence?: DropEvidence): DropSearchFailure {
  return {
    contractVersion: DROP_SEARCH_CONTRACT_VERSION, ok: false,
    error: { code, message, retryable: code === 'SOURCE_UNAVAILABLE' || code === 'SOURCE_TOO_OLD', ...(candidates ? { candidates } : {}) },
    ...(evidence ? { evidence } : {}),
  };
}

export class WarframeDataService {
  readonly #fetch: DataFetch;
  readonly #now: () => Date;
  readonly #baseUrl: string;
  readonly #alternativeBaseUrl: string | false;
  readonly #cacheFile: string;
  readonly #ttlMs: number;
  readonly #sourceAgeWarningMs: number;
  readonly #maxSourceAgeMs: number;
  readonly #timeoutMs: number;
  #snapshot?: DropSnapshot;
  #loading: Promise<{ snapshot: DropSnapshot; stale: boolean } | null> | undefined;

  constructor(options: WarframeDataServiceOptions) {
    if (!options.cacheDirectory.trim()) throw new TypeError('cacheDirectory 不能为空');
    this.#fetch = options.fetch ?? (globalThis.fetch as DataFetch);
    this.#now = options.now ?? (() => new Date());
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/u, '');
    this.#alternativeBaseUrl = options.alternativeBaseUrl === false
      ? false : (options.alternativeBaseUrl ?? DEFAULT_ALTERNATIVE_BASE_URL).replace(/\/$/u, '');
    this.#cacheFile = path.join(options.cacheDirectory, 'drop-snapshot.v2.json');
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#sourceAgeWarningMs = options.sourceAgeWarningMs ?? DEFAULT_SOURCE_AGE_WARNING_MS;
    this.#maxSourceAgeMs = options.maxSourceAgeMs ?? DEFAULT_MAX_SOURCE_AGE_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (![this.#ttlMs, this.#sourceAgeWarningMs, this.#maxSourceAgeMs, this.#timeoutMs]
      .every((value) => Number.isInteger(value) && value > 0)
      || this.#sourceAgeWarningMs >= this.#maxSourceAgeMs) {
      throw new TypeError('缓存、源年龄和超时门限必须是有效正整数，且源年龄警告门限小于拒绝门限');
    }
  }

  async #json(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new SourceFailure(`status ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error instanceof SourceFailure) throw error;
      throw new SourceFailure('unavailable');
    } finally { clearTimeout(timer); }
  }
  async #readCache(): Promise<DropSnapshot | undefined> {
    try { return parseSnapshot(JSON.parse(await readFile(this.#cacheFile, 'utf8'))); } catch { return undefined; }
  }
  async #writeCache(snapshot: DropSnapshot): Promise<void> {
    await mkdir(path.dirname(this.#cacheFile), { recursive: true });
    const temporary = `${this.#cacheFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
      await rename(temporary, this.#cacheFile);
    } finally { await rm(temporary, { force: true }); }
  }
  async #refresh(): Promise<DropSnapshot> {
    const loadedAt = this.#now();
    const primaryPromise = this.#json(`${this.#baseUrl}/info.json`).then(parseInfo).catch(() => null);
    const alternativePromise = this.#alternativeBaseUrl
      ? this.#json(`${this.#alternativeBaseUrl}/info.json`).then(parseInfo).catch(() => null)
      : Promise.resolve(null);
    const [primary, alternative] = await Promise.all([primaryPromise, alternativePromise]);
    if (!primary && !alternative) throw new SourceFailure('no source metadata');
    const preferredAlternative = Boolean(alternative && (!primary || alternative.modified > primary.modified));
    let selectedInfo = (preferredAlternative ? alternative : primary) ?? alternative!;
    let selectedEndpoint: SourceEndpoint = preferredAlternative ? 'wfcd.github-raw' : 'wfcd.jsdelivr';
    let selectedBaseUrl = preferredAlternative ? this.#alternativeBaseUrl : this.#baseUrl;
    if (!selectedBaseUrl) throw new SourceFailure('selected source missing');
    let comparison: AlternativeComparison = !this.#alternativeBaseUrl ? {
      checkedAt: loadedAt.toISOString(), status: 'not_configured', preferred: 'primary', reason: 'not_configured',
      ...(primary ? { primaryHash: primary.hash, primaryModifiedAt: new Date(primary.modified).toISOString() } : {}),
    } : primary && alternative ? {
      checkedAt: loadedAt.toISOString(), status: primary.hash === alternative.hash ? 'matched' : 'different',
      preferred: preferredAlternative ? 'alternative' : 'primary',
      reason: primary.hash === alternative.hash ? 'same_hash'
        : primary.modified === alternative.modified ? 'hash_divergence' : 'newer_source',
      primaryHash: primary.hash, alternativeHash: alternative.hash,
      primaryModifiedAt: new Date(primary.modified).toISOString(), alternativeModifiedAt: new Date(alternative.modified).toISOString(),
    } : primary ? {
      checkedAt: loadedAt.toISOString(), status: 'primary_only', preferred: 'primary', reason: 'only_available',
      primaryHash: primary.hash, primaryModifiedAt: new Date(primary.modified).toISOString(),
    } : {
      checkedAt: loadedAt.toISOString(), status: 'alternative_only', preferred: 'alternative', reason: 'only_available',
      alternativeHash: alternative!.hash, alternativeModifiedAt: new Date(alternative!.modified).toISOString(),
    };
    let batch: SourceDropBatch;
    try {
      batch = await this.#json(`${selectedBaseUrl}/all.slim.json`).then(parseDrops);
    } catch (error) {
      const fallbackInfo = selectedEndpoint === 'wfcd.github-raw' ? primary : alternative;
      const fallbackBaseUrl = selectedEndpoint === 'wfcd.github-raw' ? this.#baseUrl : this.#alternativeBaseUrl;
      if (!fallbackInfo || !fallbackBaseUrl) throw error;
      selectedInfo = fallbackInfo;
      selectedEndpoint = selectedEndpoint === 'wfcd.github-raw' ? 'wfcd.jsdelivr' : 'wfcd.github-raw';
      selectedBaseUrl = fallbackBaseUrl;
      comparison = {
        ...comparison,
        status: selectedEndpoint === 'wfcd.jsdelivr' ? 'primary_payload_only' : 'alternative_payload_only',
        preferred: selectedEndpoint === 'wfcd.jsdelivr' ? 'primary' : 'alternative',
        reason: 'payload_fallback',
      };
      batch = await this.#json(`${selectedBaseUrl}/all.slim.json`).then(parseDrops);
    }
    const snapshot = compile(selectedInfo, batch, loadedAt, selectedEndpoint, comparison);
    await this.#writeCache(snapshot);
    return snapshot;
  }
  async #loadOnce(): Promise<{ snapshot: DropSnapshot; stale: boolean } | null> {
    const cached = this.#snapshot ?? await this.#readCache();
    const fresh = cached && this.#now().getTime() - Date.parse(cached.loadedAt) <= this.#ttlMs;
    const sourceRejected = cached && this.#now().getTime() - Date.parse(cached.sourceModifiedAt) > this.#maxSourceAgeMs;
    if (fresh && !sourceRejected) { this.#snapshot = cached; return { snapshot: cached, stale: false }; }
    try {
      this.#snapshot = await this.#refresh();
      return { snapshot: this.#snapshot, stale: false };
    } catch {
      if (cached) { this.#snapshot = cached; return { snapshot: cached, stale: true }; }
      return null;
    }
  }
  async #load(): Promise<{ snapshot: DropSnapshot; stale: boolean } | null> {
    if (this.#loading) return await this.#loading;
    this.#loading = this.#loadOnce();
    try { return await this.#loading; } finally { this.#loading = undefined; }
  }

  async searchDrops(input: unknown): Promise<DropSearchResult> {
    const request = record(input);
    const limit = request?.limit ?? DEFAULT_LIMIT;
    if (request?.contractVersion !== DROP_SEARCH_CONTRACT_VERSION || typeof request.item !== 'string'
      || request.item.trim().length < 1 || request.item.length > 120
      || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) {
      return failure('INVALID_REQUEST', '掉落查询请求无效。');
    }
    const loaded = await this.#load();
    if (!loaded) return failure('SOURCE_UNAVAILABLE', '公共掉落数据暂时不可用，本地也没有可验证快照。');
    const sourceAgeMs = Math.max(0, this.#now().getTime() - Date.parse(loaded.snapshot.sourceModifiedAt));
    const sourceAgeStatus: DropEvidence['sourceAge']['status'] = sourceAgeMs > this.#maxSourceAgeMs
      ? 'rejected' : sourceAgeMs > this.#sourceAgeWarningMs ? 'aged' : 'current';
    const evidence: DropEvidence = {
      scope: 'static_drop_table', evidenceType: 'versioned_public_snapshot',
      asOf: loaded.snapshot.sourceModifiedAt, loadedAt: loaded.snapshot.loadedAt,
      expiresAt: new Date(Date.parse(loaded.snapshot.loadedAt) + this.#ttlMs).toISOString(),
      freshness: loaded.stale ? 'stale' : 'fresh', cacheFreshness: loaded.stale ? 'stale' : 'fresh',
      sourceAge: { ageMs: sourceAgeMs, status: sourceAgeStatus, warningAfterMs: this.#sourceAgeWarningMs, rejectAfterMs: this.#maxSourceAgeMs },
      finding: sourceAgeStatus === 'rejected' ? 'unavailable' : 'confirmed_present',
      source: 'wfcd.drop-data', sourceHash: loaded.snapshot.sourceHash,
      selectedEndpoint: loaded.snapshot.selectedEndpoint,
      alternativeComparison: loaded.snapshot.alternativeComparison,
    };
    if (sourceAgeStatus === 'rejected') {
      return failure('SOURCE_TOO_OLD', '公共掉落源数据已超过允许年龄，不能据此回答当前掉落位置。请稍后重试刷新。', undefined, evidence);
    }
    const query = request.item.trim();
    if (!normalize(query)) return failure('INVALID_REQUEST', '掉落查询物品名必须包含文字或数字。');
    const names = Object.keys(loaded.snapshot.items);
    const alias = resolveAlias(query);
    const lookup = alias?.canonicalItem ?? query;
    let resolved = names.find((name) => name === lookup);
    let match: DropSearchSuccess['data']['match'] = 'exact';
    if (!resolved) {
      const normalized = normalize(lookup);
      const exact = names.filter((name) => normalize(name) === normalized);
      if (exact.length === 1) { resolved = exact[0]!; match = alias ? 'alias_exact' : 'normalized_exact'; }
      else {
        const candidates = names.filter((name) => normalize(name).includes(normalized)).slice(0, 8);
        if (candidates.length === 0) return failure('ITEM_NOT_FOUND', '掉落表中没有找到匹配物品。', undefined, evidence);
        return failure('ITEM_AMBIGUOUS', '物品名称对应多个掉落表候选项。', candidates, evidence);
      }
    }
    if (resolved && alias) match = 'alias_exact';
    const resolvedItem = resolved;
    if (!resolvedItem) return failure('ITEM_NOT_FOUND', '掉落表中没有找到匹配物品。', undefined, evidence);
    const allDrops = loaded.snapshot.items[resolvedItem] ?? [];
    const warnings: DropSearchSuccess['warnings'] = [];
    if (loaded.stale) warnings.push({ code: 'STALE_SNAPSHOT', message: '刷新失败，正在使用上次验证过的本地快照。' });
    if (sourceAgeStatus === 'aged') warnings.push({ code: 'SOURCE_DATA_AGED', message: `缓存本身仍可读取，但源数据已 ${Math.floor(sourceAgeMs / 86_400_000)} 天未更新；结论仅代表该版本静态掉落表。` });
    if (loaded.snapshot.selectedEndpoint === 'wfcd.github-raw') warnings.push({ code: 'ALTERNATIVE_SOURCE_SELECTED', message: '主镜像不可用或版本较旧，已选择同一 MIT 数据集的 GitHub Raw 端点。' });
    if (loaded.snapshot.alternativeComparison.status === 'different') warnings.push({ code: 'SOURCE_MIRROR_DIVERGED', message: '两个公开端点的版本哈希不同，已按源修改时间选择较新的版本。' });
    if (['primary_only', 'primary_payload_only'].includes(loaded.snapshot.alternativeComparison.status)) warnings.push({ code: 'ALTERNATIVE_SOURCE_UNAVAILABLE', message: loaded.snapshot.alternativeComparison.status === 'primary_only' ? '替代端点元数据不可用；本次结果仅由主端点验证。' : '较新的替代端点数据文件不可用，已可解释地回退到主端点。' });
    if (loaded.snapshot.discardedRows > 0) warnings.push({ code: 'SOURCE_ROWS_DISCARDED', message: `源数据中 ${loaded.snapshot.discardedRows} 条记录没有有效掉率，已明确排除。` });
    if (allDrops.length > Number(limit)) warnings.push({ code: 'RESULT_TRUNCATED', message: `仅显示掉率最高的 ${Number(limit)} 条来源。` });
    return {
      contractVersion: DROP_SEARCH_CONTRACT_VERSION, ok: true,
      data: { requestedItem: query, resolvedItem, match, ...(alias ? { alias } : {}), drops: allDrops.slice(0, Number(limit)), totalDrops: allDrops.length },
      evidence, warnings,
    };
  }
}

export function createWarframeDataService(options: WarframeDataServiceOptions): WarframeDataService {
  return new WarframeDataService(options);
}
