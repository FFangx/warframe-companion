import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DROP_SEARCH_CONTRACT_VERSION = '1.0' as const;
const SNAPSHOT_SCHEMA_VERSION = 1 as const;
// The public site currently challenges Node/Electron clients with a 403. jsDelivr
// serves the same WFCD gh-pages snapshot without browser impersonation.
const DEFAULT_BASE_URL = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-drop-data@gh-pages/data';
const DEFAULT_TTL_MS = 24 * 60 * 60_000;
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
  finding: 'confirmed_present' | 'unavailable';
  source: 'wfcd.drop-data';
  sourceHash: string;
}
export interface DropSearchSuccess {
  contractVersion: typeof DROP_SEARCH_CONTRACT_VERSION;
  ok: true;
  data: {
    requestedItem: string;
    resolvedItem: string;
    match: 'exact' | 'normalized_exact';
    drops: DropLocation[];
    totalDrops: number;
  };
  evidence: DropEvidence;
  warnings: Array<{ code: 'STALE_SNAPSHOT' | 'RESULT_TRUNCATED' | 'SOURCE_ROWS_DISCARDED'; message: string }>;
}
export type DropSearchErrorCode = 'INVALID_REQUEST' | 'ITEM_NOT_FOUND' | 'ITEM_AMBIGUOUS' | 'SOURCE_UNAVAILABLE';
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
interface SourceDrop { place: string; item: string; rarity: string; chance: number }
interface SourceDropBatch { rows: SourceDrop[]; discardedRows: number }
interface DropSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  source: 'wfcd.drop-data';
  sourceHash: string;
  sourceModifiedAt: string;
  loadedAt: string;
  discardedRows: number;
  items: Record<string, DropLocation[]>;
}
export type DataFetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface WarframeDataServiceOptions {
  cacheDirectory: string;
  fetch?: DataFetch;
  now?: () => Date;
  baseUrl?: string;
  ttlMs?: number;
  timeoutMs?: number;
}

class SourceFailure extends Error {}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s_.·•:：'’"“”()（）\[\]{}\-/\\]+/gu, '');
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
  if (data?.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || data.source !== 'wfcd.drop-data'
    || typeof data.sourceHash !== 'string' || !data.sourceHash || !validIso(data.sourceModifiedAt)
    || !validIso(data.loadedAt) || !Number.isInteger(data.discardedRows) || Number(data.discardedRows) < 0
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
  };
}
function compile(info: SourceInfo, batch: SourceDropBatch, loadedAt: Date): DropSnapshot {
  const items: Record<string, DropLocation[]> = {};
  for (const row of batch.rows) (items[row.item] ??= []).push({ place: row.place, rarity: row.rarity, chance: row.chance });
  for (const drops of Object.values(items)) drops.sort((a, b) => b.chance - a.chance || a.place.localeCompare(b.place, 'en'));
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION, source: 'wfcd.drop-data', sourceHash: info.hash,
    sourceModifiedAt: new Date(info.modified).toISOString(), loadedAt: loadedAt.toISOString(),
    discardedRows: batch.discardedRows, items,
  };
}
function failure(code: DropSearchErrorCode, message: string, candidates?: string[], evidence?: DropEvidence): DropSearchFailure {
  return {
    contractVersion: DROP_SEARCH_CONTRACT_VERSION, ok: false,
    error: { code, message, retryable: code === 'SOURCE_UNAVAILABLE', ...(candidates ? { candidates } : {}) },
    ...(evidence ? { evidence } : {}),
  };
}

export class WarframeDataService {
  readonly #fetch: DataFetch;
  readonly #now: () => Date;
  readonly #baseUrl: string;
  readonly #cacheFile: string;
  readonly #ttlMs: number;
  readonly #timeoutMs: number;
  #snapshot?: DropSnapshot;
  #loading: Promise<{ snapshot: DropSnapshot; stale: boolean } | null> | undefined;

  constructor(options: WarframeDataServiceOptions) {
    if (!options.cacheDirectory.trim()) throw new TypeError('cacheDirectory 不能为空');
    this.#fetch = options.fetch ?? (globalThis.fetch as DataFetch);
    this.#now = options.now ?? (() => new Date());
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/u, '');
    this.#cacheFile = path.join(options.cacheDirectory, 'drop-snapshot.v1.json');
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.#ttlMs) || this.#ttlMs < 1 || !Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new TypeError('ttlMs 和 timeoutMs 必须是正整数');
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
    const [info, batch] = await Promise.all([
      this.#json(`${this.#baseUrl}/info.json`).then(parseInfo),
      this.#json(`${this.#baseUrl}/all.slim.json`).then(parseDrops),
    ]);
    const snapshot = compile(info, batch, this.#now());
    await this.#writeCache(snapshot);
    return snapshot;
  }
  async #loadOnce(): Promise<{ snapshot: DropSnapshot; stale: boolean } | null> {
    const cached = this.#snapshot ?? await this.#readCache();
    const fresh = cached && this.#now().getTime() - Date.parse(cached.loadedAt) <= this.#ttlMs;
    if (fresh) { this.#snapshot = cached; return { snapshot: cached, stale: false }; }
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
    const evidence: DropEvidence = {
      scope: 'static_drop_table', evidenceType: 'versioned_public_snapshot',
      asOf: loaded.snapshot.sourceModifiedAt, loadedAt: loaded.snapshot.loadedAt,
      expiresAt: new Date(Date.parse(loaded.snapshot.loadedAt) + this.#ttlMs).toISOString(),
      freshness: loaded.stale ? 'stale' : 'fresh', finding: 'confirmed_present',
      source: 'wfcd.drop-data', sourceHash: loaded.snapshot.sourceHash,
    };
    const query = request.item.trim();
    if (!normalize(query)) return failure('INVALID_REQUEST', '掉落查询物品名必须包含文字或数字。');
    const names = Object.keys(loaded.snapshot.items);
    let resolved = names.find((name) => name === query);
    let match: DropSearchSuccess['data']['match'] = 'exact';
    if (!resolved) {
      const normalized = normalize(query);
      const exact = names.filter((name) => normalize(name) === normalized);
      if (exact.length === 1) { resolved = exact[0]!; match = 'normalized_exact'; }
      else {
        const candidates = names.filter((name) => normalize(name).includes(normalized)).slice(0, 8);
        if (candidates.length === 0) return failure('ITEM_NOT_FOUND', '掉落表中没有找到匹配物品。', undefined, evidence);
        return failure('ITEM_AMBIGUOUS', '物品名称对应多个掉落表候选项。', candidates, evidence);
      }
    }
    const resolvedItem = resolved;
    if (!resolvedItem) return failure('ITEM_NOT_FOUND', '掉落表中没有找到匹配物品。', undefined, evidence);
    const allDrops = loaded.snapshot.items[resolvedItem] ?? [];
    const warnings: DropSearchSuccess['warnings'] = [];
    if (loaded.stale) warnings.push({ code: 'STALE_SNAPSHOT', message: '刷新失败，正在使用上次验证过的本地快照。' });
    if (loaded.snapshot.discardedRows > 0) warnings.push({ code: 'SOURCE_ROWS_DISCARDED', message: `源数据中 ${loaded.snapshot.discardedRows} 条记录没有有效掉率，已明确排除。` });
    if (allDrops.length > Number(limit)) warnings.push({ code: 'RESULT_TRUNCATED', message: `仅显示掉率最高的 ${Number(limit)} 条来源。` });
    return {
      contractVersion: DROP_SEARCH_CONTRACT_VERSION, ok: true,
      data: { requestedItem: query, resolvedItem, match, drops: allDrops.slice(0, Number(limit)), totalDrops: allDrops.length },
      evidence, warnings,
    };
  }
}

export function createWarframeDataService(options: WarframeDataServiceOptions): WarframeDataService {
  return new WarframeDataService(options);
}
