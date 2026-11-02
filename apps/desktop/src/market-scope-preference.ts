import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MARKET_PLATFORMS, type MarketPlatform, type MarketQueryRequest } from '@warframe-companion/market-query-contract';

/**
 * 主进程持有的版本化本机市场范围偏好（平台 + crossplay）。
 *
 * 路径由主进程固定（userData/config 下），renderer 只能通过受限类型化 IPC
 * 读取或显式修改；等级是物品条件，不是全局偏好，不在这里保存。写入采用
 * 临时文件 + 原子替换；读取失败按“未配置”处理且不会覆盖原文件，只有用户
 * 显式选择/保存时才替换。
 */

export const MARKET_SCOPE_PREFERENCE_FILE = 'market-scope-preference.v1.json';
export const MARKET_SCOPE_PREFERENCE_SCHEMA_VERSION = 1 as const;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export interface MarketScopePreference {
  schemaVersion: typeof MARKET_SCOPE_PREFERENCE_SCHEMA_VERSION;
  platform: MarketPlatform;
  crossplay: boolean;
  updatedAt: string;
}

/** renderer 只能提交这两个字段；平台值必须来自契约枚举，路径等一律不接受。 */
export interface MarketScopePreferenceInput {
  platform: MarketPlatform;
  crossplay: boolean;
}

export type MarketScopePreferenceErrorCode = 'SCOPE_PREFERENCE_INVALID' | 'SCOPE_PREFERENCE_STORE_INVALID';

export class MarketScopePreferenceError extends Error {
  readonly code: MarketScopePreferenceErrorCode;
  constructor(code: MarketScopePreferenceErrorCode, message: string) {
    super(message);
    this.name = 'MarketScopePreferenceError';
    this.code = code;
  }
}

export interface MarketScopePreferenceSnapshot {
  configured: boolean;
  preference?: MarketScopePreference;
  error?: { code: MarketScopePreferenceErrorCode; message: string };
}

/**
 * 每轮 agent 运行注入的范围参数：已保存偏好 → 作为默认平台/跨平台补全
 * （等级仍是物品条件，不在这里给默认）；未保存 → 让自然问价走一次选择卡。
 * 消息里明确给出的范围在 adapter 层优先于 defaults，且从不写回偏好。
 */
export type AgentRunScopeInput = { defaults: Partial<MarketQueryRequest> } | { askScopeIfMissing: true };

export function agentScopeInputFor(preference: MarketScopePreference | null | undefined): AgentRunScopeInput {
  return preference
    ? { defaults: { platform: preference.platform, crossplay: preference.crossplay } }
    : { askScopeIfMissing: true };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 校验来自 renderer 的写入输入：只接受 platform + crossplay，未知字段一律拒绝。 */
export function validateScopePreferenceInput(value: unknown): MarketScopePreferenceInput {
  const data = record(value);
  if (!data || Object.keys(data).some((key) => !['platform', 'crossplay'].includes(key))) {
    throw new MarketScopePreferenceError('SCOPE_PREFERENCE_INVALID', '默认交易范围只能包含平台与跨平台两个字段。');
  }
  if (typeof data.platform !== 'string' || !MARKET_PLATFORMS.includes(data.platform as MarketPlatform)) {
    throw new MarketScopePreferenceError('SCOPE_PREFERENCE_INVALID', '平台不受支持。');
  }
  if (typeof data.crossplay !== 'boolean') {
    throw new MarketScopePreferenceError('SCOPE_PREFERENCE_INVALID', '跨平台范围必须是布尔值。');
  }
  return { platform: data.platform as MarketPlatform, crossplay: data.crossplay };
}

function parsePreference(value: unknown): MarketScopePreference {
  const data = record(value);
  if (!data || Object.keys(data).some((key) => !['schemaVersion', 'platform', 'crossplay', 'updatedAt'].includes(key))
    || data.schemaVersion !== MARKET_SCOPE_PREFERENCE_SCHEMA_VERSION
    || typeof data.platform !== 'string' || !MARKET_PLATFORMS.includes(data.platform as MarketPlatform)
    || typeof data.crossplay !== 'boolean'
    || typeof data.updatedAt !== 'string' || !ISO_UTC.test(data.updatedAt)) {
    throw new MarketScopePreferenceError('SCOPE_PREFERENCE_STORE_INVALID', '本机市场范围偏好文件结构无效或版本未知。');
  }
  return {
    schemaVersion: MARKET_SCOPE_PREFERENCE_SCHEMA_VERSION,
    platform: data.platform as MarketPlatform,
    crossplay: data.crossplay,
    updatedAt: data.updatedAt,
  };
}

export async function loadMarketScopePreference(filePath: string): Promise<MarketScopePreferenceSnapshot> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { configured: false };
    return { configured: false, error: { code: 'SCOPE_PREFERENCE_STORE_INVALID', message: '无法读取本机市场范围偏好。' } };
  }
  try {
    return { configured: true, preference: parsePreference(JSON.parse(raw)) };
  } catch (error) {
    const message = error instanceof MarketScopePreferenceError
      ? error.message
      : '本机市场范围偏好文件不是有效 JSON。';
    return { configured: false, error: { code: 'SCOPE_PREFERENCE_STORE_INVALID', message } };
  }
}

export async function saveMarketScopePreference(filePath: string, input: unknown): Promise<MarketScopePreference> {
  const selection = validateScopePreferenceInput(input);
  const preference: MarketScopePreference = {
    schemaVersion: MARKET_SCOPE_PREFERENCE_SCHEMA_VERSION,
    platform: selection.platform,
    crossplay: selection.crossplay,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(preference, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
  return preference;
}
