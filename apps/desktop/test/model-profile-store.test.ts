import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ModelProfileStoreError,
  deleteLocalModelProfile,
  loadLocalModelProfiles,
  saveLocalModelProfile,
} from '../src/model-profile-store.js';

const temporaryDirectories: string[] = [];
async function storePath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'warframe-companion-model-store-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'model-profiles.v1.json');
}
const input = {
  id: 'synthetic-local-model', label: 'Synthetic local model', model: 'synthetic-model', description: 'Synthetic fixture',
  capabilities: { text: true, vision: false, nativeTools: true, structuredOutput: true, reasoning: false, streaming: true, cancellation: true, contextWindow: 8_192 },
  configuration: { configVersion: '1.0', baseUrl: 'http://127.0.0.1:11434/v1', api: 'chat_completions', healthCheck: 'models', credential: { kind: 'none' }, maxOutputTokens: 512 },
};
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('本机模型配置存储', () => {
  it('原子保存并读取仅含凭据引用的 profile', async () => {
    const file = await storePath();
    const saved = await saveLocalModelProfile(file, input);
    const loaded = await loadLocalModelProfiles(file);
    expect(saved.source).toBe('local_config');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.configuration?.credential).toEqual({ kind: 'none' });
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toMatch(/apiKey|authorization|Bearer/u);
  });

  it('拒绝内置 ID 冲突和损坏配置', async () => {
    const file = await storePath();
    await expect(saveLocalModelProfile(file, input, ['synthetic-local-model'])).rejects.toMatchObject({ code: 'MODEL_CONFIG_DUPLICATE' });
    await writeFile(file, '{"schemaVersion":1,"profiles":[{"apiKey":"synthetic"}]}', 'utf8');
    await expect(loadLocalModelProfiles(file)).rejects.toBeInstanceOf(ModelProfileStoreError);
  });

  it('删除只影响目标 profile', async () => {
    const file = await storePath();
    await saveLocalModelProfile(file, input);
    await saveLocalModelProfile(file, { ...input, id: 'synthetic-local-model-two', label: 'Synthetic two' });
    await deleteLocalModelProfile(file, input.id);
    expect((await loadLocalModelProfiles(file)).map((profile) => profile.id)).toEqual(['synthetic-local-model-two']);
  });
});
