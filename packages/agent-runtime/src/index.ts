import {
  MARKET_QUERY_CONTRACT_VERSION,
  type MarketEvidence,
  type MarketPlatform,
  type MarketQueryRequest,
  type MarketQueryResult,
} from '@warframe-companion/market-query-contract';

export type AgentDecision = 'call_tool' | 'clarify' | 'answer' | 'refuse';
export type RefusalReason = 'identity_untrusted' | 'private_scope' | 'write_forbidden';
export interface EvalEvidence {
  scope: 'current_market' | 'personal_snapshot';
  evidenceType: 'direct_snapshot' | 'local_snapshot';
  asOf: string;
  expiresAt: string;
  freshness: 'fresh' | 'stale';
  finding: 'confirmed_present' | 'confirmed_absent_in_scope' | 'unavailable';
  source: 'warframe.market' | 'synthetic.local';
}
export interface EvalFact { key: string; value: string | number | boolean; evidence?: EvalEvidence }
export interface ToolCallTrace { name: string; arguments: Record<string, unknown> }
export interface AgentTrace {
  caseId: string;
  decision: AgentDecision;
  toolCalls: ToolCallTrace[];
  facts: EvalFact[];
  refusalReason?: RefusalReason;
  latencyMs: number;
  modelProfileId?: string;
  terminalReason?: 'completed' | 'cancelled' | 'timeout' | 'error';
}

export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  nativeTools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  streaming: boolean;
  cancellation: boolean;
  contextWindow: number;
}
export interface ModelProfile {
  id: string;
  label: string;
  adapterId: string;
  model: string;
  description: string;
  capabilities: ModelCapabilities;
}
export interface ModelHealth {
  profileId: string;
  status: 'healthy' | 'incompatible' | 'unavailable';
  checkedAt: string;
  summary: string;
  missingCapabilities: Array<keyof Omit<ModelCapabilities, 'contextWindow'>>;
}
export type ModelTurn =
  | { kind: 'market_query'; request: MarketQueryRequest }
  | { kind: 'clarify'; text: string; facts: EvalFact[] }
  | { kind: 'answer'; text: string };
export interface ModelAdapter {
  id: string;
  checkHealth(profile: ModelProfile): Promise<{ available: boolean; summary: string }>;
  generateTurn(input: { message: string; defaults?: MarketQueryRequest; signal: AbortSignal }, profile: ModelProfile): Promise<ModelTurn>;
}

const LOCAL_CAPABILITIES: ModelCapabilities = {
  text: true, vision: false, nativeTools: true, structuredOutput: true,
  reasoning: false, streaming: true, cancellation: true, contextWindow: 16_384,
};
export const DEFAULT_MODEL_PROFILES: readonly ModelProfile[] = [
  {
    id: 'warframe-local-balanced', label: 'Warframe 本地规则 · 标准', adapterId: 'warframe-local-rules',
    model: 'local-rules-v1', description: '离线、零密钥；用于验证工具、证据、取消和轨迹链路。',
    capabilities: LOCAL_CAPABILITIES,
  },
  {
    id: 'warframe-local-compact', label: 'Warframe 本地规则 · 紧凑', adapterId: 'warframe-local-rules',
    model: 'local-rules-v1-compact', description: '同一离线后端的紧凑 profile；较小上下文，不声明视觉或推理能力。',
    capabilities: { ...LOCAL_CAPABILITIES, streaming: false, contextWindow: 4_096 },
  },
] as const;
const REQUIRED_AGENT_CAPABILITIES: Array<keyof Omit<ModelCapabilities, 'contextWindow'>> = ['text', 'nativeTools', 'structuredOutput', 'cancellation'];

export type AgentFactMode = 'none' | 'orders' | 'absent' | 'unavailable' | 'stale' | 'statistics' | 'split-orders' | 'basis' | 'snapshot' | 'failure';
export interface AgentRunRequest {
  requestId: string;
  message: string;
  modelProfileId?: string;
  timeoutMs?: number;
  context: { channel: 'desktop' | 'qq_private' | 'qq_group' | 'untrusted_test'; trustedOwner: boolean; now: string };
  evaluation?: { factMode: AgentFactMode; defaultMarketRequest?: MarketQueryRequest };
}
export type AgentStreamEvent =
  | { type: 'status'; phase: 'thinking' | 'tool' | 'composing'; text: string }
  | { type: 'model_selected'; profile: ModelProfile }
  | { type: 'tool_call'; name: 'market.query'; arguments: MarketQueryRequest }
  | { type: 'tool_result'; name: 'market.query'; ok: boolean; summary: string }
  | { type: 'message_delta'; delta: string }
  | { type: 'completed'; message: string; trace: AgentTrace };
export interface AgentRunDependencies {
  marketQuery(request: MarketQueryRequest): Promise<MarketQueryResult>;
  onEvent?(event: AgentStreamEvent): void | Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  profiles?: readonly ModelProfile[];
  adapters?: readonly ModelAdapter[];
}

function policyRefusal(message: string, request: AgentRunRequest): { reason: RefusalReason; text: string } | null {
  if (/替.*(?:挂|改|删).*单|(?:创建|修改|删除|自动).*订单|发送游戏私聊|给买家发送|自动交易/u.test(message)) return { reason: 'write_forbidden', text: '我不能操作市场、交易或游戏聊天；可以帮你查公开行情并由你手动处理。' };
  if (/原始账号快照|完整快照|导出.*快照/u.test(message)) return { reason: 'private_scope', text: '原始个人快照不能导出或展示。' };
  if (/个人库存|我的库存|白金余额|个人白金/u.test(message)) {
    if (request.context.channel === 'qq_group') return { reason: 'private_scope', text: '个人数据不能在群聊中展示。' };
    if (!request.context.trustedOwner) return { reason: 'identity_untrusted', text: '当前会话没有可信主人身份，不能读取个人数据。' };
  }
  if (/创建提醒订阅|替.*订阅/u.test(message) && !request.context.trustedOwner) return { reason: 'identity_untrusted', text: '当前会话没有可信主人身份，不能创建订阅。' };
  return null;
}
function platformFrom(message: string): MarketPlatform | undefined {
  if (/\bPC\b/iu.test(message)) return 'pc';
  if (/\bPS\b|PlayStation/iu.test(message)) return 'ps4';
  if (/Xbox/iu.test(message)) return 'xbox';
  if (/Switch/iu.test(message)) return 'switch';
  if (/移动端|mobile/iu.test(message)) return 'mobile';
  return undefined;
}
function rankFrom(message: string): number | 'max' | undefined | null {
  if (/满级|满阶|\bmax\b/iu.test(message)) return 'max';
  if (/(?:等级\s*)?负\s*[一二三四五六七八九十\d]+|-\d+/u.test(message)) return null;
  const match = message.match(/(?:等级\s*)?(\d+)\s*级|(?:，|\s)(\d+)\s*(?:。|$)/u);
  return match ? Number(match[1] ?? match[2]) : undefined;
}
function itemFrom(message: string): string | undefined {
  const patterns = [
    /查一下(.+?)(?:当前行情|行情|价格|多少钱)/u,
    /(?:查|查询)(.+?)(?:，|。|价格|行情|多少钱|$)/u,
    /这个[“"](.+?)[”"]/u,
    /^(.+?)(?:满级)?多少钱/u,
  ];
  for (const pattern of patterns) {
    const value = message.match(pattern)?.[1]?.trim();
    if (value) return value.replace(/^(?:一下|当前)/u, '').replace(/(?:满级|满阶|\d+级)$/u, '').trim();
  }
  return undefined;
}

export const localRulesModelAdapter: ModelAdapter = {
  id: 'warframe-local-rules',
  async checkHealth(profile) {
    return { available: profile.adapterId === this.id, summary: '本地规则后端可用；不会读取密钥或发起模型请求。' };
  },
  async generateTurn({ message, defaults, signal }) {
    if (signal.aborted) throw signal.reason;
    if (!defaults && /个人库存|我的库存|白金余额|个人白金|我的账号/u.test(message)) {
      return { kind: 'answer', text: '桌面 Agent 当前尚未接入个人快照；本切片只支持公开市场查询。' };
    }
    if (!defaults && !/查|查询|价格|行情|多少钱/u.test(message)) {
      return { kind: 'answer', text: '桌面 Agent 当前只支持公开市场查询，请明确物品、平台、跨平台范围和等级。' };
    }
    const rank = rankFrom(message);
    if (rank === null) return { kind: 'clarify', text: '等级必须是非负整数或 max。', facts: [{ key: 'invalid_field', value: 'rank' }] };
    const item = itemFrom(message) ?? defaults?.item;
    const platform = platformFrom(message) ?? defaults?.platform;
    const crossplay = /不跨平台|单平台/u.test(message) ? false : /跨平台/u.test(message) ? true : defaults?.crossplay;
    const resolvedRank = rank ?? defaults?.rank ?? (platform && crossplay !== undefined ? 0 : undefined);
    if (!item || !platform || crossplay === undefined || resolvedRank === undefined) {
      return { kind: 'clarify', text: '请明确平台、是否跨平台交易，以及等级（非负整数或 max）。', facts: [{ key: 'missing_field', value: 'platform,crossplay,rank' }] };
    }
    return { kind: 'market_query', request: { contractVersion: MARKET_QUERY_CONTRACT_VERSION, item, platform, crossplay, rank: resolvedRank } };
  },
};

function profileRegistry(profiles = DEFAULT_MODEL_PROFILES): Map<string, ModelProfile> { return new Map(profiles.map((profile) => [profile.id, profile])); }
function adapterRegistry(adapters: readonly ModelAdapter[] = [localRulesModelAdapter]): Map<string, ModelAdapter> { return new Map(adapters.map((adapter) => [adapter.id, adapter])); }
export function listModelProfiles(profiles: readonly ModelProfile[] = DEFAULT_MODEL_PROFILES): ModelProfile[] { return profiles.map((profile) => structuredClone(profile)); }
export async function checkModelProfile(profileId: string, options: { profiles?: readonly ModelProfile[]; adapters?: readonly ModelAdapter[]; now?: () => Date } = {}): Promise<ModelHealth> {
  const profile = profileRegistry(options.profiles).get(profileId);
  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  if (!profile) return { profileId, status: 'unavailable', checkedAt, summary: '模型 profile 不存在。', missingCapabilities: [] };
  const missingCapabilities = REQUIRED_AGENT_CAPABILITIES.filter((capability) => !profile.capabilities[capability]);
  if (missingCapabilities.length) return { profileId, status: 'incompatible', checkedAt, summary: `缺少桌面 Agent 必需能力：${missingCapabilities.join(', ')}`, missingCapabilities };
  const adapter = adapterRegistry(options.adapters).get(profile.adapterId);
  if (!adapter) return { profileId, status: 'unavailable', checkedAt, summary: `模型适配器 ${profile.adapterId} 未注册。`, missingCapabilities: [] };
  const health = await adapter.checkHealth(profile);
  return { profileId, status: health.available ? 'healthy' : 'unavailable', checkedAt, summary: health.summary, missingCapabilities: [] };
}

function toEvalEvidence(evidence: MarketEvidence): EvalEvidence { return { ...evidence }; }
function factsFor(result: MarketQueryResult, mode: AgentFactMode): EvalFact[] {
  if (mode === 'none') return [];
  const evidence = result.evidence ? toEvalEvidence(result.evidence) : undefined;
  if (mode === 'failure') {
    if (result.ok) return [];
    const facts: EvalFact[] = [{ key: 'error.code', value: result.error.code }, { key: 'error.retryable', value: result.error.retryable }];
    if (result.error.details?.retryAfterMs !== undefined) facts.push({ key: 'error.retry_after_ms', value: result.error.details.retryAfterMs });
    if (result.error.code === 'ITEM_AMBIGUOUS') facts.push({ key: 'resolution.requires_choice', value: true });
    return facts;
  }
  if (mode === 'unavailable') return evidence ? [{ key: 'market.availability', value: 'unavailable', evidence }] : [];
  if (!result.ok || !evidence) return [];
  if (mode === 'orders') return [{ key: 'market.orders', value: 'present', evidence }];
  if (mode === 'absent') return [{ key: 'market.orders', value: 'absent_in_scope', evidence }];
  if (mode === 'stale') return [{ key: 'market.current_state', value: 'unknown', evidence }];
  if (mode === 'statistics') return [{ key: 'market.orders', value: 'present', evidence }, { key: 'statistics.available', value: Boolean(result.data.statistics) }];
  if (mode === 'split-orders') return [
    { key: 'market.sell_orders', value: result.data.sellOrders.length ? 'present' : 'absent_in_scope', evidence },
    { key: 'market.buy_orders', value: result.data.buyOrders.length ? 'present' : 'absent_in_scope', evidence },
  ];
  if (mode === 'basis') return [{ key: 'market.current_order_basis', value: 'direct_snapshot', evidence }, { key: 'market.history_basis', value: 'closed_trades_90_days' }];
  return [{ key: 'market.snapshot_scope', value: 'current_market', evidence }];
}
function responseFor(result: MarketQueryResult): string {
  if (!result.ok) return `${result.error.message}${result.error.retryable ? ' 可以稍后重试。' : ''}`;
  const { item, sellOrders, buyOrders, statistics } = result.data;
  const orders = sellOrders.length || buyOrders.length ? `当前快照有 ${sellOrders.length} 条卖单、${buyOrders.length} 条买单。` : '当前查询范围内没有可见买卖单。';
  return `${item.name.zhHans}（等级 ${item.rank.resolved}/${item.rank.maxRank}）：${orders}${statistics ? ` 90 日成交中位数 ${statistics.median} 白金。` : ''} 数据时间 ${result.evidence.asOf}，来源 Warframe.Market。`;
}
async function emit(deps: AgentRunDependencies, event: AgentStreamEvent): Promise<void> { await deps.onEvent?.(event); }
function abortError(signal: AbortSignal): Error { return signal.reason instanceof Error ? signal.reason : new Error('cancelled'); }
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(abortError(signal)), { once: true })),
  ]);
}

export async function runDesktopAgent(request: AgentRunRequest, deps: AgentRunDependencies): Promise<{ message: string; trace: AgentTrace }> {
  const started = deps.now?.() ?? Date.now();
  const elapsed = () => (deps.now?.() ?? Date.now()) - started;
  const toolCalls: ToolCallTrace[] = [];
  let facts: EvalFact[] = [];
  const timeout = Math.min(Math.max(request.timeoutMs ?? 15_000, 100), 60_000);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  const forwardAbort = () => controller.abort(deps.signal?.reason ?? new Error('cancelled'));
  deps.signal?.addEventListener('abort', forwardAbort, { once: true });
  const profileId = request.modelProfileId ?? DEFAULT_MODEL_PROFILES[0]!.id;
  const profile = profileRegistry(deps.profiles).get(profileId);
  const adapter = profile ? adapterRegistry(deps.adapters).get(profile.adapterId) : undefined;
  const finish = async (message: string, decision: AgentDecision, terminalReason: AgentTrace['terminalReason'] = 'completed', refusalReason?: RefusalReason) => {
    const trace: AgentTrace = { caseId: request.requestId, decision, toolCalls, facts, latencyMs: elapsed(), modelProfileId: profileId, terminalReason, ...(refusalReason ? { refusalReason } : {}) };
    await emit(deps, { type: 'completed', message, trace });
    return { message, trace };
  };
  try {
    if (!profile || !adapter) return await finish('所选模型配置不可用，请重新选择并检查健康状态。', 'answer', 'error');
    const health = await checkModelProfile(profileId, { ...(deps.profiles ? { profiles: deps.profiles } : {}), ...(deps.adapters ? { adapters: deps.adapters } : {}) });
    if (health.status !== 'healthy') return await finish(health.summary, 'answer', 'error');
    await emit(deps, { type: 'model_selected', profile });
    await emit(deps, { type: 'status', phase: 'thinking', text: '正在通过可信策略与模型能力门禁' });
    const denied = policyRefusal(request.message, request);
    if (denied) {
      await emit(deps, { type: 'message_delta', delta: denied.text });
      return await finish(denied.text, 'refuse', 'completed', denied.reason);
    }
    const defaults = request.evaluation?.defaultMarketRequest;
    const turn = await abortable(adapter.generateTurn({ message: request.message, signal: controller.signal, ...(defaults ? { defaults } : {}) }, profile), controller.signal);
    if (controller.signal.aborted) throw abortError(controller.signal);
    if (turn.kind === 'answer') { await emit(deps, { type: 'message_delta', delta: turn.text }); return await finish(turn.text, 'answer'); }
    if (turn.kind === 'clarify') { facts = turn.facts; await emit(deps, { type: 'message_delta', delta: turn.text }); return await finish(turn.text, 'clarify'); }
    toolCalls.push({ name: 'market.query', arguments: { ...turn.request } });
    await emit(deps, { type: 'status', phase: 'tool', text: '正在查询公开市场快照' });
    await emit(deps, { type: 'tool_call', name: 'market.query', arguments: turn.request });
    const result = await abortable(deps.marketQuery(turn.request), controller.signal);
    if (controller.signal.aborted) throw abortError(controller.signal);
    await emit(deps, { type: 'tool_result', name: 'market.query', ok: result.ok, summary: result.ok ? result.evidence.finding : result.error.code });
    facts = factsFor(result, request.evaluation?.factMode ?? 'none');
    const text = responseFor(result);
    await emit(deps, { type: 'status', phase: 'composing', text: '正在按证据组织回答' });
    for (const delta of text.match(/.{1,24}/gu) ?? []) await emit(deps, { type: 'message_delta', delta });
    return await finish(text, 'call_tool');
  } catch (error) {
    const timedOut = controller.signal.reason instanceof Error && controller.signal.reason.message === 'timeout';
    const message = timedOut ? '本轮 Agent 已超时停止，可调整请求后重试。' : '本轮 Agent 已停止；未继续执行或提交任何写操作。';
    return await finish(message, 'answer', timedOut ? 'timeout' : 'cancelled');
  } finally {
    clearTimeout(timeoutHandle);
    deps.signal?.removeEventListener('abort', forwardAbort);
  }
}
