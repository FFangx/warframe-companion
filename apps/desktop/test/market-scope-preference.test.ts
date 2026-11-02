import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MARKET_SCOPE_PREFERENCE_FILE,
  MARKET_SCOPE_PREFERENCE_SCHEMA_VERSION,
  MarketScopePreferenceError,
  agentScopeInputFor,
  loadMarketScopePreference,
  saveMarketScopePreference,
  validateScopePreferenceInput,
} from '../src/market-scope-preference.js';
import { MARKET_SCOPE_OPTIONS } from '@warframe-companion/agent-runtime';
import { MARKET_PLATFORMS } from '@warframe-companion/market-query-contract';

async function tempStorePath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'warframe-scope-preference-'));
  return path.join(dir, MARKET_SCOPE_PREFERENCE_FILE);
}

describe('desktop market scope preference store', () => {
  it('treats a missing file as unconfigured without an error', async () => {
    const snapshot = await loadMarketScopePreference(await tempStorePath());
    expect(snapshot).toEqual({ configured: false });
  });

  it('saves and reloads a versioned preference at the fixed path', async () => {
    const filePath = await tempStorePath();
    const saved = await saveMarketScopePreference(filePath, { platform: 'pc', crossplay: true });
    expect(saved.schemaVersion).toBe(MARKET_SCOPE_PREFERENCE_SCHEMA_VERSION);
    expect(saved.platform).toBe('pc');
    expect(saved.crossplay).toBe(true);
    expect(Number.isFinite(Date.parse(saved.updatedAt))).toBe(true);
    const snapshot = await loadMarketScopePreference(filePath);
    expect(snapshot.configured).toBe(true);
    expect(snapshot.preference).toEqual(saved);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(saved);
  });

  it('rejects renderer inputs with unknown fields or values (typed IPC guard)', async () => {
    const filePath = await tempStorePath();
    expect(() => validateScopePreferenceInput({ platform: 'ps5', crossplay: true })).toThrowError(MarketScopePreferenceError);
    expect(() => validateScopePreferenceInput({ platform: 'pc', crossplay: 'yes' })).toThrowError(MarketScopePreferenceError);
    expect(() => validateScopePreferenceInput({ platform: 'pc', crossplay: true, updatedAt: '2030-01-01T00:00:00.000Z' })).toThrowError(MarketScopePreferenceError);
    expect(() => validateScopePreferenceInput({ platform: 'pc' })).toThrowError(MarketScopePreferenceError);
    expect(() => validateScopePreferenceInput(null)).toThrowError(MarketScopePreferenceError);
    expect(() => validateScopePreferenceInput({ platform: 'pc', crossplay: true })).not.toThrow();
    // Nothing was written for the rejected inputs.
    const snapshot = await loadMarketScopePreference(filePath);
    expect(snapshot.configured).toBe(false);
    expect(snapshot.error).toBeUndefined();
  });

  it('reports corrupt store as unconfigured and never overwrites on read', async () => {
    const filePath = await tempStorePath();
    await writeFile(filePath, '{not json', 'utf8');
    const snapshot = await loadMarketScopePreference(filePath);
    expect(snapshot.configured).toBe(false);
    expect(snapshot.error?.code).toBe('SCOPE_PREFERENCE_STORE_INVALID');
    expect(await readFile(filePath, 'utf8')).toBe('{not json');
  });

  it('reports an unknown schema version as unconfigured without overwriting', async () => {
    const filePath = await tempStorePath();
    await writeFile(filePath, JSON.stringify({ schemaVersion: 99, platform: 'pc', crossplay: true, updatedAt: '2030-01-01T00:00:00.000Z' }), 'utf8');
    const snapshot = await loadMarketScopePreference(filePath);
    expect(snapshot.configured).toBe(false);
    expect(snapshot.error?.code).toBe('SCOPE_PREFERENCE_STORE_INVALID');
    expect(JSON.parse(await readFile(filePath, 'utf8')).schemaVersion).toBe(99);
  });

  it('persists an explicit re-save even after a corrupt file', async () => {
    const filePath = await tempStorePath();
    await writeFile(filePath, '{not json', 'utf8');
    const saved = await saveMarketScopePreference(filePath, { platform: 'xbox', crossplay: true });
    expect(saved.platform).toBe('xbox');
    const snapshot = await loadMarketScopePreference(filePath);
    expect(snapshot).toEqual({ configured: true, preference: saved });
  });

  it('maps a saved preference to per-run defaults and an unset one to the one-time choice flag', () => {
    const saved = { schemaVersion: 1 as const, platform: 'pc' as const, crossplay: true, updatedAt: '2030-01-01T00:00:00.000Z' };
    expect(agentScopeInputFor(saved)).toEqual({ defaults: { platform: 'pc', crossplay: true } });
    expect(agentScopeInputFor(null)).toEqual({ askScopeIfMissing: true });
    expect(agentScopeInputFor(undefined)).toEqual({ askScopeIfMissing: true });
    expect(agentScopeInputFor({ ...saved, crossplay: false })).toEqual({ defaults: { platform: 'pc', crossplay: false } });
  });
});

describe('market scope choice options', () => {
  it('are stable, unique, and carry canonical platform/crossplay values', () => {
    expect(MARKET_SCOPE_OPTIONS.length).toBeGreaterThan(1);
    expect(new Set(MARKET_SCOPE_OPTIONS.map((option) => option.id)).size).toBe(MARKET_SCOPE_OPTIONS.length);
    for (const option of MARKET_SCOPE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(MARKET_PLATFORMS).toContain(option.platform);
      expect(typeof option.crossplay).toBe('boolean');
    }
  });

  it('starts with the OpenClaw shortcut baseline pc/true marked recommended, with a pc local variant', () => {
    const first = MARKET_SCOPE_OPTIONS[0]!;
    expect(first).toMatchObject({ id: 'pc-crossplay', platform: 'pc', crossplay: true, recommended: true });
    expect(MARKET_SCOPE_OPTIONS.some((option) => option.platform === 'pc' && option.crossplay === false)).toBe(true);
    expect(MARKET_SCOPE_OPTIONS.some((option) => option.platform === 'pc' && option.id === 'pc-local')).toBe(true);
  });
});
