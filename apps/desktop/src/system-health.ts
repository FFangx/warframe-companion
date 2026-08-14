import { access } from 'node:fs/promises';
import { connect } from 'node:net';

export type HealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'not_configured';
export type HealthFinding = 'confirmed_present' | 'unavailable' | 'unknown';

export interface ComponentHealth {
  id: 'desktop' | 'openclaw' | 'wfinfo' | 'alecaframe' | 'market';
  label: string;
  status: HealthStatus;
  summary: string;
  evidence: {
    scope: string;
    evidenceType: 'direct_probe' | 'build_identity' | 'configuration_check';
    asOf: string;
    freshness: 'fresh';
    finding: HealthFinding;
    source: string;
  };
}

export interface SystemHealthSnapshot {
  schemaVersion: '1.0';
  overall: 'healthy' | 'degraded';
  checkedAt: string;
  components: ComponentHealth[];
}

type TcpProbe = (host: string, port: number, timeoutMs: number) => Promise<boolean>;
type PathProbe = (path: string) => Promise<boolean>;
type FetchProbe = (input: string, init?: RequestInit) => Promise<Response>;

export interface SystemHealthOptions {
  appVersion: string;
  buildId: string;
  now?: () => Date;
  environment?: NodeJS.ProcessEnv;
  tcpProbe?: TcpProbe;
  pathProbe?: PathProbe;
  fetch?: FetchProbe;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2_500;

async function defaultPathProbe(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function defaultTcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (result: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function component(
  id: ComponentHealth['id'],
  label: string,
  status: HealthStatus,
  summary: string,
  checkedAt: string,
  evidenceType: ComponentHealth['evidence']['evidenceType'],
  finding: HealthFinding,
  source: string,
): ComponentHealth {
  return {
    id,
    label,
    status,
    summary,
    evidence: {
      scope: `system_component:${id}`,
      evidenceType,
      asOf: checkedAt,
      freshness: 'fresh',
      finding,
      source,
    },
  };
}

async function configuredPathHealth(
  id: 'wfinfo' | 'alecaframe',
  label: string,
  variable: string,
  environment: NodeJS.ProcessEnv,
  checkedAt: string,
  pathProbe: PathProbe,
): Promise<ComponentHealth> {
  const path = environment[variable]?.trim();
  if (!path) {
    return component(
      id,
      label,
      'not_configured',
      `尚未通过 ${variable} 配置检测路径`,
      checkedAt,
      'configuration_check',
      'unknown',
      variable,
    );
  }
  const exists = await pathProbe(path);
  return component(
    id,
    label,
    exists ? 'healthy' : 'unavailable',
    exists ? '已找到只读集成路径' : '已配置路径当前不可访问',
    checkedAt,
    'direct_probe',
    exists ? 'confirmed_present' : 'unavailable',
    variable,
  );
}

async function marketHealth(
  checkedAt: string,
  fetchProbe: FetchProbe,
  timeoutMs: number,
): Promise<ComponentHealth> {
  const source = 'https://api.warframe.market/v2/items';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchProbe(source, {
      headers: { Accept: 'application/json', Language: 'zh-hans' },
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => undefined);
    const healthy = response.ok;
    return component(
      'market',
      'Warframe.Market',
      healthy ? 'healthy' : 'unavailable',
      healthy ? '公共市场数据源可达' : `公共市场数据源返回 HTTP ${response.status}`,
      checkedAt,
      'direct_probe',
      healthy ? 'confirmed_present' : 'unavailable',
      source,
    );
  } catch {
    return component(
      'market',
      'Warframe.Market',
      'unavailable',
      controller.signal.aborted ? '公共市场数据源探测超时' : '公共市场数据源当前不可达',
      checkedAt,
      'direct_probe',
      'unavailable',
      source,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function getSystemHealth(options: SystemHealthOptions): Promise<SystemHealthSnapshot> {
  const now = options.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const environment = options.environment ?? process.env;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tcpProbe = options.tcpProbe ?? defaultTcpProbe;
  const pathProbe = options.pathProbe ?? defaultPathProbe;
  const fetchProbe = options.fetch ?? (globalThis.fetch as FetchProbe);
  const openClawHost = environment.WARFRAME_COMPANION_OPENCLAW_HOST?.trim() || '127.0.0.1';
  const configuredPort = Number(environment.WARFRAME_COMPANION_OPENCLAW_PORT ?? 18_789);
  const openClawPort = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : 18_789;

  const [openClawAvailable, wfinfo, alecaFrame, market] = await Promise.all([
    tcpProbe(openClawHost, openClawPort, timeoutMs),
    configuredPathHealth('wfinfo', 'WFInfo', 'WARFRAME_COMPANION_WFINFO_EXE', environment, checkedAt, pathProbe),
    configuredPathHealth('alecaframe', 'AlecaFrame', 'WARFRAME_COMPANION_ALECAFRAME_DIR', environment, checkedAt, pathProbe),
    marketHealth(checkedAt, fetchProbe, timeoutMs),
  ]);

  const components: ComponentHealth[] = [
    component(
      'desktop',
      '桌面应用',
      'healthy',
      `版本 ${options.appVersion} · 构建 ${options.buildId}`,
      checkedAt,
      'build_identity',
      'confirmed_present',
      'desktop-runtime',
    ),
    component(
      'openclaw',
      'OpenClaw',
      openClawAvailable ? 'healthy' : 'unavailable',
      openClawAvailable ? '本机 Gateway 端口可达' : '本机 Gateway 端口当前不可达',
      checkedAt,
      'direct_probe',
      openClawAvailable ? 'confirmed_present' : 'unavailable',
      `tcp://${openClawHost}:${openClawPort}`,
    ),
    wfinfo,
    alecaFrame,
    market,
  ];

  return {
    schemaVersion: '1.0',
    overall: components.every((entry) => entry.status === 'healthy') ? 'healthy' : 'degraded',
    checkedAt,
    components,
  };
}
