import {
  MARKET_QUERY_CONTRACT_VERSION,
  type MarketEvidence,
  type MarketPlatform,
  type MarketQueryRequest,
  type MarketQueryResult,
} from '@warframe-companion/market-query-contract';
import {
  DROP_SEARCH_CONTRACT_VERSION,
  type DropSearchRequest,
  type DropSearchResult,
} from '@warframe-companion/warframe-data-service';

export type AgentDecision = 'call_tool' | 'clarify' | 'answer' | 'refuse';
export type RefusalReason = 'identity_untrusted' | 'private_scope' | 'write_forbidden';
export interface EvalEvidence {
  scope: 'current_market' | 'personal_snapshot' | 'static_drop_table';
  evidenceType: 'direct_snapshot' | 'local_snapshot' | 'versioned_public_snapshot';
  asOf: string;
  expiresAt: string;
  loadedAt?: string;
  freshness: 'fresh' | 'stale';
  finding: 'confirmed_present' | 'confirmed_absent_in_scope' | 'unavailable';
  source: 'warframe.market' | 'synthetic.local' | 'wfcd.drop-data';
  sourceHash?: string;
  cacheFreshness?: 'fresh' | 'stale';
  sourceAge?: { ageMs: number; status: 'current' | 'aged' | 'rejected'; warningAfterMs: number; rejectAfterMs: number };
  selectedEndpoint?: 'wfcd.jsdelivr' | 'wfcd.github-raw';
  alternativeComparison?: {
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
  conclusion?: 'answered' | 'insufficient_data';
  conclusionSource?: 'model' | 'harness';
  modelFailure?: ModelFailure;
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
  source?: 'built_in' | 'local_config';
  configuration?: OpenAICompatibleConfiguration;
}
export const OPENAI_COMPATIBLE_CONFIG_VERSION = '1.0' as const;
export type CredentialReference =
  | { kind: 'none' }
  | { kind: 'environment'; variable: string };
export interface OpenAICompatibleConfiguration {
  configVersion: typeof OPENAI_COMPATIBLE_CONFIG_VERSION;
  baseUrl: string;
  api: 'chat_completions';
  healthCheck: 'models';
  credential: CredentialReference;
  maxOutputTokens: number;
}
export type ModelErrorCode =
  | 'MODEL_CONFIG_INVALID'
  | 'MODEL_CREDENTIAL_UNAVAILABLE'
  | 'MODEL_AUTH_REJECTED'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_TIMEOUT'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_BAD_RESPONSE'
  | 'MODEL_CAPABILITY_MISMATCH'
  | 'MODEL_CANCELLED';
export interface ModelFailure {
  code: ModelErrorCode;
  category: 'configuration' | 'authentication' | 'upstream' | 'protocol' | 'cancelled';
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}
export class ModelAdapterError extends Error {
  readonly failure: ModelFailure;
  constructor(failure: ModelFailure) {
    super(failure.message);
    this.name = 'ModelAdapterError';
    this.failure = failure;
  }
}
export interface ModelHealth {
  profileId: string;
  status: 'healthy' | 'incompatible' | 'unavailable';
  checkedAt: string;
  summary: string;
  missingCapabilities: Array<keyof Omit<ModelCapabilities, 'contextWindow'>>;
  error?: ModelFailure;
}
export type ModelTurn =
  | { kind: 'market_query'; request: MarketQueryRequest }
  | { kind: 'drop_search'; request: DropSearchRequest }
  | { kind: 'clarify'; text: string; facts: EvalFact[] }
  | { kind: 'answer'; text: string; streamed?: boolean }
  | { kind: 'conclude'; text: string; conclusion: 'answered' | 'insufficient_data' };
export interface ToolRoundStep {
  toolName: 'market.query' | 'drops.search';
  toolCall: Record<string, unknown>;
  toolResultSummary: string;
}
export interface ModelAdapter {
  id: string;
  /**
   * 声明该 adapter 支持工具结果回送的多轮生成。为 true 时，Harness 在每次工具
   * 执行后把脱敏的工具轮记录回传给 generateTurn，期待 answer 或 agent.conclude
   * 终态；为 false 时继续使用 Harness 确定性组织回答（本地规则后端）。
   */
  supportsToolRoundTrip?: boolean;
  checkHealth(profile: ModelProfile, signal?: AbortSignal): Promise<{ available: boolean; summary: string; error?: ModelFailure }>;
  generateTurn(input: {
    message: string;
    defaults?: MarketQueryRequest;
    history?: readonly ToolRoundStep[];
    signal: AbortSignal;
    onTextDelta?: (delta: string) => void | Promise<void>;
  }, profile: ModelProfile): Promise<ModelTurn>;
}

const LOCAL_CAPABILITIES: ModelCapabilities = {
  text: true, vision: false, nativeTools: true, structuredOutput: true,
  reasoning: false, streaming: true, cancellation: true, contextWindow: 16_384,
};
export const DEFAULT_MODEL_PROFILES: readonly ModelProfile[] = [
  {
    id: 'warframe-local-balanced', label: 'Warframe 本地规则 · 标准', adapterId: 'warframe-local-rules',
    model: 'local-rules-v1', description: '离线、零密钥；用于验证工具、证据、取消和轨迹链路。',
    capabilities: LOCAL_CAPABILITIES, source: 'built_in',
  },
  {
    id: 'warframe-local-compact', label: 'Warframe 本地规则 · 紧凑', adapterId: 'warframe-local-rules',
    model: 'local-rules-v1-compact', description: '同一离线后端的紧凑 profile；较小上下文，不声明视觉或推理能力。',
    capabilities: { ...LOCAL_CAPABILITIES, streaming: false, contextWindow: 4_096 }, source: 'built_in',
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
  | { type: 'tool_call'; name: 'drops.search'; arguments: DropSearchRequest }
  | { type: 'tool_result'; name: 'market.query' | 'drops.search'; ok: boolean; summary: string }
  | { type: 'model_error'; error: ModelFailure }
  | { type: 'message_delta'; delta: string }
  | { type: 'model_conclusion'; conclusion: 'answered' | 'insufficient_data'; source: 'model' | 'harness' }
  | { type: 'completed'; message: string; trace: AgentTrace };
export interface AgentRunDependencies {
  marketQuery(request: MarketQueryRequest): Promise<MarketQueryResult>;
  searchDrops?(request: DropSearchRequest): Promise<DropSearchResult>;
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
function dropItemFrom(message: string): string | undefined {
  const patterns = [
    /^(?:查(?:询)?\s*)?(.+?)(?:在哪里|从哪里|哪里|哪儿)?(?:掉落|怎么刷|去哪刷)[？?。.]*$/u,
    /^(?:where\s+(?:does|do|can)\s+)?(.+?)\s+(?:drop|drops)[?!.]*$/iu,
  ];
  for (const pattern of patterns) {
    const value = message.trim().match(pattern)?.[1]?.trim();
    if (value) return value;
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
    const dropItem = dropItemFrom(message);
    if (!defaults && dropItem) {
      return { kind: 'drop_search', request: { contractVersion: DROP_SEARCH_CONTRACT_VERSION, item: dropItem } };
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
  return { profileId, status: health.available ? 'healthy' : 'unavailable', checkedAt, summary: health.summary, missingCapabilities: [], ...(health.error ? { error: health.error } : {}) };
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
function dropResponseFor(result: DropSearchResult): string {
  if (!result.ok) {
    if (result.error.code === 'ITEM_AMBIGUOUS') return `名称不够明确：${result.error.candidates?.join('、') ?? '请补充完整英文物品名'}。`;
    if (result.error.code === 'SOURCE_TOO_OLD' && result.evidence) {
      return `${result.error.message} 本地缓存为${result.evidence.cacheFreshness === 'fresh' ? '新鲜缓存' : '陈旧缓存'}，但源数据年龄已达 ${Math.floor(result.evidence.sourceAge.ageMs / 86_400_000)} 天，超过 ${Math.floor(result.evidence.sourceAge.rejectAfterMs / 86_400_000)} 天门禁。`;
    }
    return result.error.message;
  }
  const locations = result.data.drops.slice(0, 5)
    .map((drop) => `${drop.place}（${drop.chance}%）`).join('；');
  const stale = result.evidence.freshness === 'stale' ? ' 当前使用上次验证过的旧快照。' : '';
  const alias = result.data.alias ? ` 已将${result.data.alias.language === 'zh-Hans' ? '中文' : '英文'}别名“${result.data.alias.matched}”解析为 ${result.data.alias.canonicalItem}（项目 MIT 别名表）。` : '';
  const comparison = result.evidence.alternativeComparison.status === 'matched' ? '两个公开端点版本一致。'
    : `替代源对照为 ${result.evidence.alternativeComparison.status}，采用${result.evidence.alternativeComparison.preferred === 'alternative' ? '替代' : '主'}端点。`;
  const sourceAge = result.evidence.sourceAge.status === 'aged'
    ? `源数据已 ${Math.floor(result.evidence.sourceAge.ageMs / 86_400_000)} 天未更新，只能视为版本化静态资料。`
    : '源数据年龄通过门禁。';
  return `${result.data.resolvedItem} 的公开掉落表来源：${locations}。共 ${result.data.totalDrops} 条，数据版本时间 ${result.evidence.asOf}，来源 WFCD drop-data。${alias} 缓存状态为${result.evidence.cacheFreshness === 'fresh' ? '新鲜' : '陈旧'}；${sourceAge}${comparison}${stale}`;
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

function marketToolSummary(result: MarketQueryResult): string {
  if (!result.ok) return `market.query 失败：${result.error.code} ${result.error.message}${result.error.retryable ? '（可重试）' : ''}。`;
  const { item, sellOrders, buyOrders, statistics } = result.data;
  return `market.query 成功：${item.name.zhHans}（等级 ${item.rank.resolved}/${item.rank.maxRank}），卖单 ${sellOrders.length} 条、买单 ${buyOrders.length} 条${statistics ? `，90 日成交中位数 ${statistics.median} 白金` : ''}；快照时间 ${result.evidence.asOf}，来源 warframe.market。`;
}
function dropToolSummary(result: DropSearchResult): string {
  if (!result.ok) {
    const age = result.evidence ? `；源年龄 ${result.evidence.sourceAge.status}` : '';
    return `drops.search 失败：${result.error.code} ${result.error.message}${age}。`;
  }
  const locations = result.data.drops.slice(0, 5).map((drop) => `${drop.place}（${drop.chance}%）`).join('、');
  return `drops.search 成功：${result.data.resolvedItem} 共 ${result.data.totalDrops} 条公开掉落来源，最高概率前五：${locations}；缓存 ${result.evidence.cacheFreshness}、源年龄 ${result.evidence.sourceAge.status}、替代源对照 ${result.evidence.alternativeComparison.status}，来源 wfcd.drop-data。`;
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
  const finish = async (
    message: string, decision: AgentDecision, terminalReason: AgentTrace['terminalReason'] = 'completed', refusalReason?: RefusalReason,
    conclusion?: AgentTrace['conclusion'], conclusionSource?: AgentTrace['conclusionSource'], modelFailure?: ModelFailure,
  ) => {
    const trace: AgentTrace = {
      caseId: request.requestId, decision, toolCalls, facts, latencyMs: elapsed(), modelProfileId: profileId, terminalReason,
      ...(refusalReason ? { refusalReason } : {}),
      ...(conclusion && conclusionSource ? { conclusion, conclusionSource } : {}),
      ...(modelFailure ? { modelFailure } : {}),
    };
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
    let streamedText = '';
    const onTextDelta = async (delta: string) => {
      streamedText += delta;
      await emit(deps, { type: 'message_delta', delta });
    };
    let turn = await abortable(adapter.generateTurn({
      message: request.message,
      signal: controller.signal,
      ...(defaults ? { defaults } : {}),
      onTextDelta,
    }, profile), controller.signal);
    if (controller.signal.aborted) throw abortError(controller.signal);
    if (turn.kind === 'answer') {
      if (!turn.streamed || streamedText.length === 0) await emit(deps, { type: 'message_delta', delta: turn.text });
      return await finish(turn.text, 'answer');
    }
    if (turn.kind === 'clarify') { facts = turn.facts; await emit(deps, { type: 'message_delta', delta: turn.text }); return await finish(turn.text, 'clarify'); }
    if (turn.kind === 'conclude') {
      await emit(deps, { type: 'model_error', error: { code: 'MODEL_BAD_RESPONSE', category: 'protocol', message: '模型在工具执行前提交了终态。', retryable: false } });
      return await finish('模型在工具执行前提交了终态，属于协议错误。', 'answer', 'error');
    }

    const MAX_TOOL_ROUNDS = 3;
    const toolRounds: ToolRoundStep[] = [];
    let lastText = '';
    let lastOk = false;
    let modelFailure: ModelFailure | undefined;
    const deterministicFinish = async () => {
      await emit(deps, { type: 'status', phase: 'composing', text: '正在按工具证据组织回答' });
      for (const delta of lastText.match(/.{1,24}/gu) ?? []) await emit(deps, { type: 'message_delta', delta });
      const conclusion: NonNullable<AgentTrace['conclusion']> = lastOk ? 'answered' : 'insufficient_data';
      await emit(deps, { type: 'model_conclusion', conclusion, source: 'harness' });
      return await finish(lastText, 'call_tool', 'completed', undefined, conclusion, 'harness', modelFailure);
    };
    const modelFinish = async (text: string, conclusion: NonNullable<AgentTrace['conclusion']>) => {
      await emit(deps, { type: 'model_conclusion', conclusion, source: 'model' });
      return await finish(text, 'call_tool', 'completed', undefined, conclusion, 'model', modelFailure);
    };

    for (;;) {
      if (turn.kind === 'market_query') {
        toolCalls.push({ name: 'market.query', arguments: { ...turn.request } });
        await emit(deps, { type: 'status', phase: 'tool', text: '正在查询公开市场快照' });
        await emit(deps, { type: 'tool_call', name: 'market.query', arguments: turn.request });
        const result = await abortable(deps.marketQuery(turn.request), controller.signal);
        if (controller.signal.aborted) throw abortError(controller.signal);
        await emit(deps, { type: 'tool_result', name: 'market.query', ok: result.ok, summary: result.ok ? result.evidence.finding : result.error.code });
        facts = factsFor(result, request.evaluation?.factMode ?? 'none');
        lastText = responseFor(result);
        lastOk = result.ok;
        toolRounds.push({ toolName: 'market.query', toolCall: { ...turn.request }, toolResultSummary: marketToolSummary(result) });
      } else if (turn.kind === 'drop_search') {
        toolCalls.push({ name: 'drops.search', arguments: { ...turn.request } });
        await emit(deps, { type: 'status', phase: 'tool', text: '正在读取版本化公共掉落快照' });
        await emit(deps, { type: 'tool_call', name: 'drops.search', arguments: turn.request });
        if (!deps.searchDrops) return await finish('本地掉落数据服务尚未配置。', 'answer', 'error');
        const result = await abortable(deps.searchDrops(turn.request), controller.signal);
        if (controller.signal.aborted) throw abortError(controller.signal);
        await emit(deps, { type: 'tool_result', name: 'drops.search', ok: result.ok, summary: result.ok ? result.evidence.freshness : result.error.code });
        if (result.ok) {
          facts = [
            { key: 'drops.source_count', value: result.data.totalDrops, evidence: { ...result.evidence } },
            { key: 'drops.cache_freshness', value: result.evidence.cacheFreshness, evidence: { ...result.evidence } },
            { key: 'drops.source_age_status', value: result.evidence.sourceAge.status, evidence: { ...result.evidence } },
            { key: 'drops.alternative_status', value: result.evidence.alternativeComparison.status, evidence: { ...result.evidence } },
          ];
        } else facts = [
          { key: 'drops.error', value: result.error.code },
          ...(result.evidence ? [{ key: 'drops.source_age_status', value: result.evidence.sourceAge.status, evidence: { ...result.evidence } } satisfies EvalFact] : []),
        ];
        lastText = dropResponseFor(result);
        lastOk = result.ok;
        toolRounds.push({ toolName: 'drops.search', toolCall: { ...turn.request }, toolResultSummary: dropToolSummary(result) });
      } else {
        // 第二轮起才允许非工具轮：answer 与 agent.conclude 是唯二合法终态，
        // clarify 等一律回落 Harness 确定性组织回答（模型不得在工具后自行澄清/拒绝）。
        if (turn.kind === 'answer') {
          if (!turn.streamed || streamedText.length === 0) await emit(deps, { type: 'message_delta', delta: turn.text });
          return await modelFinish(turn.text, 'answered');
        }
        if (turn.kind === 'conclude' && turn.conclusion === 'answered') {
          await emit(deps, { type: 'status', phase: 'composing', text: '正在采用模型提交的终态回答' });
          for (const delta of turn.text.match(/.{1,24}/gu) ?? []) await emit(deps, { type: 'message_delta', delta });
          return await modelFinish(turn.text, 'answered');
        }
        if (turn.kind === 'conclude' && turn.conclusion === 'insufficient_data' && !lastOk) {
          await emit(deps, { type: 'status', phase: 'composing', text: '模型声明数据不足，采用确定性工具结果' });
          for (const delta of lastText.match(/.{1,24}/gu) ?? []) await emit(deps, { type: 'message_delta', delta });
          return await modelFinish(lastText, 'insufficient_data');
        }
        // 工具成功后声明数据不足、工具后澄清等都属于终态滥用，回落 Harness 确定性回答。
        return await deterministicFinish();
      }
      if (!adapter.supportsToolRoundTrip || toolRounds.length >= MAX_TOOL_ROUNDS) return await deterministicFinish();
      await emit(deps, { type: 'status', phase: 'composing', text: '正在把工具结果回送模型生成回答' });
      try {
        turn = await abortable(adapter.generateTurn({
          message: request.message,
          history: toolRounds,
          signal: controller.signal,
          onTextDelta,
        }, profile), controller.signal);
      } catch (error) {
        if (error instanceof ModelAdapterError && error.failure.code !== 'MODEL_CANCELLED') {
          modelFailure = error.failure;
          await emit(deps, { type: 'model_error', error: error.failure });
          return await deterministicFinish();
        }
        throw error;
      }
      if (controller.signal.aborted) throw abortError(controller.signal);
    }
  } catch (error) {
    const timedOut = controller.signal.reason instanceof Error && controller.signal.reason.message === 'timeout';
    if (error instanceof ModelAdapterError && error.failure.code !== 'MODEL_CANCELLED') {
      facts = [{ key: 'model.error_code', value: error.failure.code }, { key: 'model.error_retryable', value: error.failure.retryable }];
      await emit(deps, { type: 'model_error', error: error.failure });
      return await finish(error.failure.message, 'answer', 'error');
    }
    const message = timedOut ? '本轮 Agent 已超时停止，可调整请求后重试。' : '本轮 Agent 已停止；未继续执行或提交任何写操作。';
    return await finish(message, 'answer', timedOut ? 'timeout' : 'cancelled');
  } finally {
    clearTimeout(timeoutHandle);
    deps.signal?.removeEventListener('abort', forwardAbort);
  }
}

export {
  OPENAI_COMPATIBLE_ADAPTER_ID,
  createOpenAICompatibleAdapter,
  createOpenAICompatibleProfile,
  type CredentialResolver,
  type ModelFetch,
  type OpenAICompatibleAdapterOptions,
  type OpenAICompatibleProfileInput,
} from './openai-compatible.js';
