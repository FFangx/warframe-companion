import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createOpenAICompatibleProfile,
  type ModelProfile,
  type OpenAICompatibleProfileInput,
} from '@warframe-companion/agent-runtime';

const STORE_SCHEMA_VERSION = 1 as const;
export const MODEL_PROFILE_STORE_FILE = 'model-profiles.v1.json';
export type ModelProfileStoreErrorCode = 'MODEL_CONFIG_STORE_INVALID' | 'MODEL_CONFIG_DUPLICATE' | 'MODEL_CONFIG_NOT_FOUND';
export class ModelProfileStoreError extends Error {
  readonly code: ModelProfileStoreErrorCode;
  constructor(code: ModelProfileStoreErrorCode, message: string) { super(message); this.name = 'ModelProfileStoreError'; this.code = code; }
}
interface StoredProfiles { schemaVersion: typeof STORE_SCHEMA_VERSION; profiles: OpenAICompatibleProfileInput[] }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function toInput(profile: ModelProfile): OpenAICompatibleProfileInput {
  if (!profile.configuration) throw new ModelProfileStoreError('MODEL_CONFIG_STORE_INVALID', '本机 profile 缺少 provider 配置。');
  return {
    id: profile.id, label: profile.label, model: profile.model, description: profile.description,
    capabilities: structuredClone(profile.capabilities), configuration: structuredClone(profile.configuration),
  };
}
function parseStore(value: unknown): ModelProfile[] {
  const data = record(value);
  if (!data || Object.keys(data).some((key) => !['schemaVersion', 'profiles'].includes(key))
    || data.schemaVersion !== STORE_SCHEMA_VERSION || !Array.isArray(data.profiles)) {
    throw new ModelProfileStoreError('MODEL_CONFIG_STORE_INVALID', '本机模型配置文件结构无效。');
  }
  try {
    const profiles = data.profiles.map(createOpenAICompatibleProfile);
    if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
      throw new ModelProfileStoreError('MODEL_CONFIG_DUPLICATE', '本机模型配置包含重复 profile ID。');
    }
    return profiles;
  } catch (error) {
    if (error instanceof ModelProfileStoreError) throw error;
    throw new ModelProfileStoreError('MODEL_CONFIG_STORE_INVALID', error instanceof Error ? error.message : '本机模型配置无效。');
  }
}
async function readStore(filePath: string): Promise<ModelProfile[]> {
  try { return parseStore(JSON.parse(await readFile(filePath, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    if (error instanceof ModelProfileStoreError) throw error;
    throw new ModelProfileStoreError('MODEL_CONFIG_STORE_INVALID', '本机模型配置文件不是有效 JSON。');
  }
}
async function writeStore(filePath: string, profiles: readonly ModelProfile[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  const payload: StoredProfiles = { schemaVersion: STORE_SCHEMA_VERSION, profiles: profiles.map(toInput) };
  try {
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, filePath);
  } finally { await rm(temporary, { force: true }); }
}

export async function loadLocalModelProfiles(filePath: string): Promise<ModelProfile[]> {
  return readStore(filePath);
}
export async function saveLocalModelProfile(filePath: string, input: unknown, reservedIds: readonly string[] = []): Promise<ModelProfile> {
  const profile = createOpenAICompatibleProfile(input);
  if (reservedIds.includes(profile.id)) throw new ModelProfileStoreError('MODEL_CONFIG_DUPLICATE', '该 profile ID 由内置配置占用。');
  const profiles = await readStore(filePath);
  const next = [...profiles.filter((entry) => entry.id !== profile.id), profile].sort((left, right) => left.id.localeCompare(right.id, 'en'));
  await writeStore(filePath, next);
  return profile;
}
export async function deleteLocalModelProfile(filePath: string, profileId: string): Promise<void> {
  const profiles = await readStore(filePath);
  const next = profiles.filter((profile) => profile.id !== profileId);
  if (next.length === profiles.length) throw new ModelProfileStoreError('MODEL_CONFIG_NOT_FOUND', '本机模型 profile 不存在。');
  await writeStore(filePath, next);
}
