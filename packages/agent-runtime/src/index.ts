import {
  assertMarketQueryRequest,
  MARKET_QUERY_CONTRACT_VERSION,
  type MarketQueryRequest,
  type MarketQueryResult,
} from '@warframe-companion/market-query-contract';
import {
  MARKET_SCOPE_OPTIONS,
  SCOPE_CHOICE_PROMPT,
  marketScopeFromMessage,
  normalizeMarketQueryRequest,
  scopeChoiceRequired,
  type MarketScopeOption,
} from './market-scope.js';
import {
  DROP_SEARCH_CONTRACT_VERSION,
  type DropSearchRequest,
  type DropSearchResult,
} from '@warframe-companion/warframe-data-service';
import {
  ACCOUNT_SNAPSHOT_CONTRACT_VERSION,
  type AccountSnapshotRequest,
  type AccountSnapshotResult,
} from './account-snapshot.js';
import { DEFAULT_RUN_POLICY, resolveRunPolicy, type RunPolicy } from './run-policy.js';

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
  source: 'warframe.market' | 'synthetic.local' | 'wfcd.drop-data' | 'alecaframe.local';
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
  adapterVersion?: number;
  usage?: ModelUsage;
  finishReason?: ModelFinishReason;
  /** D2a1：实际进入领域工具执行的次数（成功、失败都算），与 toolCalls 长度一致。 */
  toolAttempts?: number;
  /** D2a1：实际发起的模型生成请求次数（含最终汇总）。 */
  modelRequests?: number;
  /** D2a1：是否经过受限最终汇总，以及由谁提交最终回答。 */
  finalizedBy?: 'model' | 'harness';
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
  | { kind: 'account_snapshot'; request: AccountSnapshotRequest }
  | { kind: 'clarify'; text: string; facts: EvalFact[] }
  | { kind: 'answer'; text: string; streamed?: boolean }
  | { kind: 'conclude'; text: string; conclusion: 'answered' | 'insufficient_data' };
export interface ToolRoundStep {
  toolName: 'market.query' | 'drops.search' | 'account.snapshot';
  toolCall: Record<string, unknown>;
  toolResultSummary: string;
  /** 产生该工具调用的模型思维链，回送时按 provider 要求原样拼回 assistant 消息。 */
  assistantReasoning?: string;
}
export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
export type ModelFinishReason = string;
export interface ModelTurnResult {
  turn: ModelTurn;
  /** 模型响应的 token 用量（adapter 可观察时提供），Harness 汇总进 AgentTrace。 */
  usage?: ModelUsage;
  /** 本次模型响应结束原因（stop/tool_calls/length/...），取最后一轮。 */
  finishReason?: ModelFinishReason;
  /**
   * 模型思维链（如 DeepSeek reasoning_content）。Harness 只把它作为不透明数据
   * 原样回传给需要它的 provider（思考模式要求回传），不进入 AgentTrace、
   * 不展示给用户，也不参与评估。
   */
  reasoning?: string;
}
export interface ModelAdapter {
  id: string;
  /**
   * adapter 接口版本。新增能力、字段或语义时必须递增，避免无声破坏既有
   * profile/backend；Harness 把它记录进 AgentTrace 便于审计与迁移。
   */
  adapterVersion: number;
  /**
   * 声明该 adapter 支持工具结果回送的多轮生成。为 true 时，Harness 在每次工具
   * 执行后把脱敏的工具轮记录回传给 generateTurn，期待 answer 或 agent.conclude
   * 终态；为 false 时继续使用 Harness 确定性组织回答（本地规则后端）。
   */
  supportsToolRoundTrip?: boolean;
  checkHealth(profile: ModelProfile, signal?: AbortSignal): Promise<{ available: boolean; summary: string; error?: ModelFailure }>;
  generateTurn(input: {
    message: string;
    defaults?: Partial<MarketQueryRequest>;
    history?: readonly ToolRoundStep[];
    signal: AbortSignal;
    onTextDelta?: (delta: string) => void | Promise<void>;
    /**
     * decide（默认）：正常决策，契约允许携带注册业务工具。
     * finalize：受限最终汇总（预算边界/第 15 次观察后）；adapter 不得暴露或
     * 执行业务工具，只应返回最终回答文本。Harness 同时有执行门禁兜底。
     */
    mode?: 'decide' | 'finalize';
  }, profile: ModelProfile): Promise<ModelTurnResult>;
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

export interface AgentRunRequest {
  requestId: string;
  message: string;
  modelProfileId?: string;
  /**
   * 兼容入口：只允许把硬截止时间缩短（renderer 不能提高预算）。
   * 与 runPolicy.hardDeadlineMs 取更小值；保留显式更短测试超时。
   */
  timeoutMs?: number;
  /**
   * 运行预算覆盖值（可选）。生产桌面由主进程构造（默认 DEFAULT_RUN_POLICY，
   * 120 秒），模型与 renderer 都看不到或不能提高预算；非法值回落默认。
   * 只包含 D2a1 的循环预算字段，plan/repair 预算属于 D2c/D2a2。
   */
  runPolicy?: Partial<RunPolicy>;
  /**
   * 调用方补全的市场参数默认值（可选，生产桌面由主进程按已保存偏好注入）。
   * 建议只携带平台/跨平台范围：等级是物品条件，不进入全局偏好；未指定等级
   * 时由 Harness 在工具执行前按“消息明确条件 → defaults → 0”程序归一化，
   * 不依赖模型遵守提示。任何 adapter 返回的 market_query 都会先经该归一化
   * 再执行，模型给错范围不能覆盖本条消息的明确条件或已保存偏好。
   * 用户可以只传局部字段（Partial），评估驱动器仍可传完整请求。
   */
  defaults?: Partial<MarketQueryRequest>;
  /**
   * 未保存默认范围且自然市场问价缺平台/跨平台时，用一次选择卡代替纯文本追问。
   * 由 Harness 在调用模型之前模型无关地判定并稳定发出（仅桌面主进程在偏好
   * 未配置时设置；未设置时保持原有文本澄清行为）。选择后主进程保存偏好并
   * 重跑原消息；本卡与消息临时范围都不自动写偏好。
   */
  askScopeIfMissing?: boolean;
  context: { channel: 'desktop' | 'qq_private' | 'qq_group' | 'untrusted_test'; trustedOwner: boolean; now: string };
}
export type AgentStreamEvent =
  | { type: 'status'; phase: 'thinking' | 'tool' | 'composing'; text: string }
  | { type: 'model_selected'; profile: ModelProfile }
  | { type: 'tool_call'; name: 'market.query'; arguments: MarketQueryRequest }
  | { type: 'tool_call'; name: 'drops.search'; arguments: DropSearchRequest }
  | { type: 'tool_call'; name: 'account.snapshot'; arguments: AccountSnapshotRequest }
  | { type: 'tool_result'; name: 'market.query' | 'drops.search' | 'account.snapshot'; ok: boolean; summary: string }
  | { type: 'model_error'; error: ModelFailure }
  | { type: 'message_delta'; delta: string }
  | { type: 'model_conclusion'; conclusion: 'answered' | 'insufficient_data'; source: 'model' | 'harness' }
  | { type: 'scope_choice_required'; questionId: string; prompt: string; options: readonly MarketScopeOption[] }
  | { type: 'completed'; message: string; trace: AgentTrace };
export interface AgentRunDependencies {
  /**
   * 领域工具尽量贯穿同一 AbortSignal；未支持 signal 的实现可以忽略，
   * Harness 仍会把迟到结果与已提交终态隔离。
   */
  marketQuery(request: MarketQueryRequest, signal?: AbortSignal): Promise<MarketQueryResult>;
  searchDrops?(request: DropSearchRequest, signal?: AbortSignal): Promise<DropSearchResult>;
  getSnapshot?(request: AccountSnapshotRequest, signal?: AbortSignal): Promise<AccountSnapshotResult>;
  onEvent?(event: AgentStreamEvent): void | Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  profiles?: readonly ModelProfile[];
  adapters?: readonly ModelAdapter[];
}

function personalScopeRefusal(request: AgentRunRequest): { reason: RefusalReason; text: string } | null {
  if (request.context.channel === 'qq_group') return { reason: 'private_scope', text: '个人数据不能在群聊中展示。' };
  if (!request.context.trustedOwner) return { reason: 'identity_untrusted', text: '当前会话没有可信主人身份，不能读取个人数据。' };
  return null;
}
/**
 * 该澄清是否由“缺少平台/跨平台范围”引起；只有这种情况才允许用一次选择卡
 * 代替文本追问（由主进程按偏好是否已保存决定启用）。
 */
function isMissingMarketScope(turn: ModelTurn): boolean {
  if (turn.kind !== 'clarify') return false;
  return turn.facts.some((fact) => {
    if (fact.key !== 'missing_field') return false;
    const fields = String(fact.value).split(',').map((field) => field.trim());
    return fields.includes('platform') || fields.includes('crossplay');
  });
}
function policyRefusal(message: string, request: AgentRunRequest): { reason: RefusalReason; text: string } | null {
  if (/替.*(?:挂|改|删).*单|(?:创建|修改|删除|自动).*订单|发送游戏私聊|给买家发送|自动交易/u.test(message)) return { reason: 'write_forbidden', text: '我不能操作市场、交易或游戏聊天；可以帮你查公开行情并由你手动处理。' };
  if (/原始账号快照|完整快照|导出.*快照/u.test(message)) return { reason: 'private_scope', text: '原始个人快照不能导出或展示。' };
  if (/个人库存|我的库存|白金余额|个人白金|我的账号|账号状态|我的遗物|我的赋能/u.test(message)) return personalScopeRefusal(request);
  if (/创建提醒订阅|替.*订阅/u.test(message) && !request.context.trustedOwner) return { reason: 'identity_untrusted', text: '当前会话没有可信主人身份，不能创建订阅。' };
  return null;
}
function itemFrom(message: string): string | undefined {
  const patterns = [
    /查一下(.+?)(?:当前行情|行情|价格|多少钱)/u,
    /查(?:询)?(.+?)(?:，|。|价格|行情|多少钱|$)/u,
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
  adapterVersion: 2,
  async checkHealth(profile) {
    return { available: profile.adapterId === this.id, summary: '本地规则后端可用；不会读取密钥或发起模型请求。' };
  },
  async generateTurn({ message, defaults, signal }) {
    if (signal.aborted) throw signal.reason;
    if (/个人库存|我的库存|白金余额|个人白金|我的账号|账号状态|我的遗物|我的赋能/u.test(message)) {
      // Harness 的策略门禁已保证走到这里的请求来自可信主人（群聊/非主人/原始导出
      // 会在 policyRefusal 被拒）；adapter 只做结构化路由，数据可用性由 getSnapshot
      // 服务决定，模型永远拿不到原始快照。注意该路由不受 defaults 门控：
      // 生产桌面配置了市场范围偏好后（defaults 由主进程注入）个人查询同样必须路由。
      const item = message.match(/我的库存\s*(.+?)(?:[，。；;]|$)/u)?.[1]?.trim();
      return {
        turn: {
          kind: 'account_snapshot',
          request: { contractVersion: ACCOUNT_SNAPSHOT_CONTRACT_VERSION, ...(item && item.length <= 120 ? { item } : {}) },
        },
      };
    }
    const dropItem = dropItemFrom(message);
    if (dropItem) {
      // 同样不受 defaults 门控：掉落查询与市场范围偏好无关。
      return { turn: { kind: 'drop_search', request: { contractVersion: DROP_SEARCH_CONTRACT_VERSION, item: dropItem } } };
    }
    // 调用方在 defaults 中给出具体物品（显式市场请求，例如评估驱动）即视为明确的
    // 市场查询；生产桌面只注入平台/跨平台偏好、从不带物品，寒暄仍按非市场意图处理。
    const explicitMarketItem = typeof defaults?.item === 'string' && defaults.item.trim().length > 0;
    if (!explicitMarketItem && !/查|查询|价格|行情|多少钱/u.test(message)) {
      // 非市场意图（寒暄等）不因存在范围偏好就当成问价：没有明确市场意图时
      // 直接说明当前能力，而不是追问市场参数或弹出一次选择卡。
      return { turn: { kind: 'answer', text: '桌面 Agent 当前只支持公开市场查询，请明确物品、平台、跨平台范围和等级。' } };
    }
    const scope = marketScopeFromMessage(message);
    if (scope.rank === null) return { turn: { kind: 'clarify', text: '等级必须是非负整数或 max。', facts: [{ key: 'invalid_field', value: 'rank' }] } };
    const item = itemFrom(message) ?? defaults?.item;
    const platform = scope.platform ?? defaults?.platform;
    const crossplay = scope.crossplay ?? defaults?.crossplay;
    // 等级缺省规则：未明确给出时按“可升级物品默认 0 级”补全；'max' 与等级上界由
    // 领域服务按物品元数据求值；套装/部件等不适用等级的物品按 maxRank=0 处理，
    // 不会要求玩家提供等级。
    const resolvedRank = scope.rank ?? defaults?.rank ?? (platform && crossplay !== undefined ? 0 : undefined);
    if (!item || !platform || crossplay === undefined || resolvedRank === undefined) {
      return { turn: { kind: 'clarify', text: '请明确平台、是否跨平台交易，以及等级（非负整数或 max）。', facts: [{ key: 'missing_field', value: 'platform,crossplay,rank' }] } };
    }
    return { turn: { kind: 'market_query', request: { contractVersion: MARKET_QUERY_CONTRACT_VERSION, item, platform, crossplay, rank: resolvedRank } } };
  },
};

function profileRegistry(profiles = DEFAULT_MODEL_PROFILES): Map<string, ModelProfile> { return new Map(profiles.map((profile) => [profile.id, profile])); }
function adapterRegistry(adapters: readonly ModelAdapter[] = [localRulesModelAdapter]): Map<string, ModelAdapter> { return new Map(adapters.map((adapter) => [adapter.id, adapter])); }
export function listModelProfiles(profiles: readonly ModelProfile[] = DEFAULT_MODEL_PROFILES): ModelProfile[] { return profiles.map((profile) => structuredClone(profile)); }
export async function checkModelProfile(profileId: string, options: {
  profiles?: readonly ModelProfile[];
  adapters?: readonly ModelAdapter[];
  now?: () => Date;
  /** 与运行共享的取消信号：健康检查（以及它背后的网络请求）尽量同源取消。 */
  signal?: AbortSignal;
  /** 健康检查超时（RunPolicy.healthTimeoutMs）；不传则不额外限时。 */
  timeoutMs?: number;
} = {}): Promise<ModelHealth> {
  const profile = profileRegistry(options.profiles).get(profileId);
  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  if (!profile) return { profileId, status: 'unavailable', checkedAt, summary: '模型 profile 不存在。', missingCapabilities: [] };
  const missingCapabilities = REQUIRED_AGENT_CAPABILITIES.filter((capability) => !profile.capabilities[capability]);
  if (missingCapabilities.length) return { profileId, status: 'incompatible', checkedAt, summary: `缺少桌面 Agent 必需能力：${missingCapabilities.join(', ')}`, missingCapabilities };
  const adapter = adapterRegistry(options.adapters).get(profile.adapterId);
  if (!adapter) return { profileId, status: 'unavailable', checkedAt, summary: `模型适配器 ${profile.adapterId} 未注册。`, missingCapabilities: [] };
  if (options.signal?.aborted) {
    const failure: ModelFailure = { code: 'MODEL_CANCELLED', category: 'cancelled', message: '模型健康检查已取消。', retryable: false };
    return { profileId, status: 'unavailable', checkedAt, summary: failure.message, missingCapabilities: [], error: failure };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = Number.isInteger(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? setTimeout(() => { timedOut = true; controller.abort(new Error('health check timeout')); }, Number(options.timeoutMs)) : undefined;
  const forwardAbort = () => controller.abort(options.signal?.reason ?? new Error('cancelled'));
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const health = await Promise.race([
      adapter.checkHealth(profile, controller.signal),
      new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('cancelled')), { once: true })),
    ]);
    return { profileId, status: health.available ? 'healthy' : 'unavailable', checkedAt, summary: health.summary, missingCapabilities: [], ...(health.error ? { error: health.error } : {}) };
  } catch (error) {
    const failure: ModelFailure = timedOut
      ? { code: 'MODEL_TIMEOUT', category: 'upstream', message: '模型健康检查超时。', retryable: true }
      : { code: 'MODEL_CANCELLED', category: 'cancelled', message: '模型健康检查已取消。', retryable: false };
    return { profileId, status: 'unavailable', checkedAt, summary: failure.message, missingCapabilities: [], error: failure };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * 市场工具结果的规范事实投影：无论生产还是评估，Harness 都无条件从工具结果
 * 派生同一组 facts 写入轨迹（不再有 evaluation.factMode 切换投影形态）。
 * 评估只断言这些事实，不再改变 Agent 的生产行为。
 */
function marketFacts(result: MarketQueryResult): EvalFact[] {
  if (!result.ok) {
    const facts: EvalFact[] = [];
    if (result.evidence) facts.push({ key: 'market.availability', value: 'unavailable', evidence: result.evidence });
    facts.push({ key: 'error.code', value: result.error.code });
    facts.push({ key: 'error.retryable', value: result.error.retryable });
    if (result.error.details?.retryAfterMs !== undefined) facts.push({ key: 'error.retry_after_ms', value: result.error.details.retryAfterMs });
    if (result.error.code === 'ITEM_AMBIGUOUS') facts.push({ key: 'resolution.requires_choice', value: true });
    return facts;
  }
  if (!result.evidence) return [];
  const facts: EvalFact[] = [
    { key: 'market.sell_orders', value: result.data.sellOrders.length ? 'present' : 'absent_in_scope', evidence: result.evidence },
    { key: 'market.buy_orders', value: result.data.buyOrders.length ? 'present' : 'absent_in_scope', evidence: result.evidence },
    { key: 'market.snapshot_scope', value: 'current_market', evidence: result.evidence },
    { key: 'market.current_order_basis', value: 'direct_snapshot', evidence: result.evidence },
    { key: 'market.history_basis', value: 'closed_trades_90_days' },
    { key: 'statistics.available', value: Boolean(result.data.statistics) },
  ];
  if (result.evidence.freshness === 'stale') facts.push({ key: 'market.current_state', value: 'unknown', evidence: result.evidence });
  return facts;
}
export function factKeyFor(name: string): string {
  const normalized = name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '_');
  return normalized || 'item';
}
/**
 * 个人快照的规范事实投影：与市场/掉落一样无条件派生（生产=评估）。
 * 只投影脱敏摘要事实（数量/总额/时间），不投影任何原始字段。
 */
function accountFacts(result: AccountSnapshotResult): EvalFact[] {
  if (!result.ok) {
    const facts: EvalFact[] = [];
    if (result.evidence) facts.push({ key: 'personal.availability', value: 'unavailable', evidence: result.evidence });
    facts.push({ key: 'error.code', value: result.error.code });
    facts.push({ key: 'error.retryable', value: result.error.retryable });
    return facts;
  }
  const evidence = result.evidence;
  const facts: EvalFact[] = [
    { key: 'personal.snapshot_scope', value: 'personal_snapshot', evidence },
    { key: 'personal.snapshot_at', value: result.data.snapshotAt, evidence },
    { key: 'personal.mastery_rank', value: result.data.totals.masteryRank },
    { key: 'personal.platinum', value: result.data.totals.platinum },
    { key: 'personal.ducats', value: result.data.totals.ducats },
    { key: 'personal.credits', value: result.data.totals.credits },
    { key: 'personal.matched', value: result.data.items.length },
  ];
  for (const item of result.data.items) facts.push({ key: `personal.item.${factKeyFor(item.name)}`, value: item.count });
  return facts;
}
function accountResponseFor(result: AccountSnapshotResult): string {
  if (!result.ok) return `${result.error.message}${result.error.retryable ? ' 可以稍后重试。' : ''}`;
  const { requestedItem, totals, items, snapshotAt } = result.data;
  const matched = items.length > 0
    ? `命中 ${items.length} 项：${items.map((item) => `${item.name}×${item.count}`).join('、')}。`
    : requestedItem ? `${requestedItem} 未持有。` : '无物品明细。';
  return `个人账号快照（${snapshotAt}）：段位 ${totals.masteryRank}，白金 ${totals.platinum}，杜卡德 ${totals.ducats}，现金 ${totals.credits}；${matched}来源 ${result.evidence.source}。`;
}
function accountToolSummary(result: AccountSnapshotResult): string {
  if (!result.ok) return `account.snapshot 失败：${result.error.code} ${result.error.message}${result.error.retryable ? '（可重试）' : ''}。`;
  return `account.snapshot 成功：${result.data.items.length} 项命中${result.data.requestedItem ? `（${result.data.requestedItem}）` : ''}，白金 ${result.data.totals.platinum}、杜卡德 ${result.data.totals.ducats}、现金 ${result.data.totals.credits}；快照时间 ${result.data.snapshotAt}，来源 ${result.evidence.source}。`;
}
function addUsage(current: ModelUsage | undefined, next: ModelUsage): ModelUsage {
  if (!current) return { ...next };
  return {
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
    totalTokens: current.totalTokens + next.totalTokens,
  };
}
function responseFor(result: MarketQueryResult): string {
  if (!result.ok) {
    if (result.error.code === 'ITEM_AMBIGUOUS') {
      const candidates = result.error.details?.candidates?.map((candidate) => candidate.name.zhHans).join('、');
      return candidates ? `${result.error.message} 请在候选中选择：${candidates}。` : `${result.error.message} 请补充更完整的名称。`;
    }
    return `${result.error.message}${result.error.retryable ? ' 可以稍后重试。' : ''}`;
  }
  const { item, sellOrders, buyOrders, statistics } = result.data;
  // 等级只在物品实际可升级时展示：套装/部件等 maxRank=0 的条目不要求等级。
  const rankText = item.rank.maxRank > 0 ? `（等级 ${item.rank.resolved}/${item.rank.maxRank}）` : '（无需等级）';
  const orders = sellOrders.length || buyOrders.length ? `当前快照有 ${sellOrders.length} 条卖单、${buyOrders.length} 条买单。` : '当前查询范围内没有可见买卖单。';
  return `${item.name.zhHans}${rankText}：${orders}${statistics ? ` 90 日成交中位数 ${statistics.median} 白金。` : ''} 数据时间 ${result.evidence.asOf}，来源 Warframe.Market。`;
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
/** 某阶段（模型请求 / 领域工具 / 最终汇总）自身的超时边界，区别于整个 run 的硬超时。 */
class PhaseTimeoutError extends Error {
  readonly phase: 'model' | 'tool' | 'finalize';
  constructor(phase: 'model' | 'tool' | 'finalize') {
    super(`phase timeout: ${phase}`);
    this.name = 'PhaseTimeoutError';
    this.phase = phase;
  }
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
  const now = () => deps.now?.() ?? Date.now();
  const policy = resolveRunPolicy(request.runPolicy, request.timeoutMs);
  const toolCalls: ToolCallTrace[] = [];
  let facts: EvalFact[] = [];
  let usage: ModelUsage | undefined;
  let finishReason: ModelFinishReason | undefined;
  const deadlineAt = started + policy.hardDeadlineMs;
  const softDeadlineAt = Math.max(started, deadlineAt - policy.finalizeReserveMs);
  const remainingUntil = (until: number) => Math.max(0, until - now());
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(new Error('timeout')), policy.hardDeadlineMs);
  const forwardAbort = () => controller.abort(deps.signal?.reason ?? new Error('cancelled'));
  deps.signal?.addEventListener('abort', forwardAbort, { once: true });
  /**
   * 每个阶段（模型请求 / 领域工具 / 最终汇总）绑定到同一运行 AbortSignal，并
   * 施加该阶段自身的超时上限。无法真正中止的底层 I/O 由 abortable 竞速隔离：
   * 迟到结果无法覆盖已经提交的终态。
   */
  const runPhase = async <T>(phase: 'model' | 'tool' | 'finalize', timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw abortError(controller.signal);
    const phaseController = new AbortController();
    const timer = setTimeout(() => phaseController.abort(new PhaseTimeoutError(phase)), timeoutMs);
    const forward = () => phaseController.abort(controller.signal.reason ?? new Error('cancelled'));
    controller.signal.addEventListener('abort', forward, { once: true });
    try {
      return await abortable(work(phaseController.signal), phaseController.signal);
    } catch (error) {
      // 阶段计时器先触发（而不是整个 run 被取消）时，把 adapter/工具自身
      // 抛出的取消归一化为阶段超时，避免误报成“用户取消”。
      if (phaseController.signal.aborted && phaseController.signal.reason instanceof PhaseTimeoutError
        && !controller.signal.aborted && !(error instanceof PhaseTimeoutError)) {
        throw phaseController.signal.reason;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', forward);
    }
  };
  const profileId = request.modelProfileId ?? DEFAULT_MODEL_PROFILES[0]!.id;
  const profile = profileRegistry(deps.profiles).get(profileId);
  const adapter = profile ? adapterRegistry(deps.adapters).get(profile.adapterId) : undefined;
  const adapterVersion = adapter?.adapterVersion;
  let toolAttempts = 0;
  let modelRequestsUsed = 0;
  let finalizedBy: AgentTrace['finalizedBy'];
  /** 终态一次性：任何路径最多调用一次 finish 并提交一个 completed 事件。 */
  let settledResult: { message: string; trace: AgentTrace } | undefined;
  const finish = async (
    message: string, decision: AgentDecision, terminalReason: AgentTrace['terminalReason'] = 'completed', refusalReason?: RefusalReason,
    conclusion?: AgentTrace['conclusion'], conclusionSource?: AgentTrace['conclusionSource'], modelFailure?: ModelFailure,
  ) => {
    if (settledResult) return settledResult;
    const trace: AgentTrace = {
      caseId: request.requestId, decision, toolCalls, facts, latencyMs: elapsed(), modelProfileId: profileId, terminalReason,
      toolAttempts, modelRequests: modelRequestsUsed,
      ...(refusalReason ? { refusalReason } : {}),
      ...(conclusion && conclusionSource ? { conclusion, conclusionSource } : {}),
      ...(modelFailure ? { modelFailure } : {}),
      ...(finalizedBy ? { finalizedBy } : {}),
      ...(adapterVersion !== undefined ? { adapterVersion } : {}),
      ...(usage ? { usage } : {}),
      ...(finishReason ? { finishReason } : {}),
    };
    settledResult = { message, trace };
    try { await emit(deps, { type: 'completed', message, trace }); } catch { /* 事件通道故障不能产生第二个终态 */ }
    return settledResult;
  };
  /** 终态路径上的事件尽力送达：通道故障时仍只提交一次终态。 */
  const safeEmit = async (event: AgentStreamEvent): Promise<void> => { try { await emit(deps, event); } catch { /* best-effort */ } };
  const toolRounds: ToolRoundStep[] = [];
  let lastText = '';
  let lastOk = false;
  let modelFailure: ModelFailure | undefined;
  const tokenBudgetExceeded = () => usage !== undefined && usage.totalTokens >= policy.totalTokenBudget;
  const deterministicFinish = async (options: { terminalReason?: 'completed' | 'cancelled' | 'timeout' | 'error' } = {}) => {
    await safeEmit({ type: 'status', phase: 'composing', text: '正在按工具证据组织回答' });
    const text = lastText.trim() ? lastText : '本轮未获得可用的工具证据，已按已有信息收束。';
    for (const delta of text.match(/.{1,24}/gu) ?? []) await safeEmit({ type: 'message_delta', delta });
    const conclusion: NonNullable<AgentTrace['conclusion']> = lastOk ? 'answered' : 'insufficient_data';
    await safeEmit({ type: 'model_conclusion', conclusion, source: 'harness' });
    return await finish(text, 'call_tool', options.terminalReason ?? 'completed', undefined, conclusion, 'harness', modelFailure);
  };
  const modelFinish = async (text: string, conclusion: NonNullable<AgentTrace['conclusion']>) => {
    await safeEmit({ type: 'model_conclusion', conclusion, source: 'model' });
    return await finish(text, 'call_tool', 'completed', undefined, conclusion, 'model', modelFailure);
  };
  try {
    if (!profile || !adapter) return await finish('所选模型配置不可用，请重新选择并检查健康状态。', 'answer', 'error');
    const healthTimeoutMs = Math.min(policy.healthTimeoutMs, Math.max(1, remainingUntil(deadlineAt)));
    const health = await abortable(checkModelProfile(profileId, {
      ...(deps.profiles ? { profiles: deps.profiles } : {}),
      ...(deps.adapters ? { adapters: deps.adapters } : {}),
      signal: controller.signal,
      timeoutMs: healthTimeoutMs,
    }), controller.signal);
    if (controller.signal.aborted) throw abortError(controller.signal);
    if (health.status !== 'healthy') {
      const terminalReason: AgentTrace['terminalReason'] = health.error?.code === 'MODEL_TIMEOUT' ? 'timeout' : 'error';
      return await finish(health.summary, 'answer', terminalReason, undefined, undefined, undefined, health.error);
    }
    await emit(deps, { type: 'model_selected', profile });
    await emit(deps, { type: 'status', phase: 'thinking', text: '正在通过可信策略与模型能力门禁' });
    const denied = policyRefusal(request.message, request);
    if (denied) {
      await emit(deps, { type: 'message_delta', delta: denied.text });
      return await finish(denied.text, 'refuse', 'completed', denied.reason);
    }
    const defaults = request.defaults;
    // 模型无关的一次选择卡预检：未保存默认范围且自然市场问价缺平台/跨平台时，
    // 在调用任何 adapter 生成（即调用模型）之前由 Harness 稳定发出。这样返回
    // 普通文本而不是结构化 clarify 的 OpenAI-compatible adapter 也无法绕过；
    // 掉落、个人查询、寒暄、写操作拒绝与明确完整范围已在判定中排除。
    // 选择后由桌面主进程保存偏好并重跑原消息；本卡不自动写任何设置。
    if (scopeChoiceRequired(request.message, defaults, request.askScopeIfMissing)) {
      const explicit = marketScopeFromMessage(request.message);
      const missingFields = [
        ...(explicit.platform !== undefined || defaults?.platform !== undefined ? [] : ['platform']),
        ...(explicit.crossplay !== undefined || defaults?.crossplay !== undefined ? [] : ['crossplay']),
      ];
      facts = [{ key: 'missing_field', value: missingFields.join(',') }];
      await emit(deps, {
        type: 'scope_choice_required',
        questionId: `scope-${request.requestId}`,
        prompt: SCOPE_CHOICE_PROMPT,
        options: MARKET_SCOPE_OPTIONS.map((option) => ({ ...option })),
      });
      await emit(deps, { type: 'message_delta', delta: SCOPE_CHOICE_PROMPT });
      return await finish(SCOPE_CHOICE_PROMPT, 'clarify');
    }

    // 受限最终汇总（finalize）：仅允许一次；adapter 在 finalize 模式下不暴露
    // 业务工具，Harness 再以执行门禁兜底拒绝任何业务调用，绝不执行第 16 次。
    let finalizeAttempted = false;
    const enterFinalize = async (): Promise<{ message: string; trace: AgentTrace }> => {
      if (finalizeAttempted) return await deterministicFinish();
      finalizeAttempted = true;
      const canFinalize = adapter.supportsToolRoundTrip === true && toolRounds.length > 0;
      if (!canFinalize || modelRequestsUsed >= policy.maxModelRequests || tokenBudgetExceeded() || remainingUntil(deadlineAt) <= 0) {
        return await deterministicFinish();
      }
      await safeEmit({ type: 'status', phase: 'composing', text: '正在生成受限最终汇总（仅允许最终回答，不提供业务工具）' });
      const timeoutMs = Math.min(policy.finalizeRequestTimeoutMs, Math.max(1, remainingUntil(deadlineAt)));
      try {
        modelRequestsUsed += 1;
        const finalResult = await runPhase('finalize', timeoutMs, (signal) => adapter.generateTurn({
          message: request.message,
          history: toolRounds,
          signal,
          mode: 'finalize',
        }, profile));
        if (finalResult.usage) usage = addUsage(usage, finalResult.usage);
        if (finalResult.finishReason) finishReason = finalResult.finishReason;
        if (controller.signal.aborted) throw abortError(controller.signal);
        const finalTurn = finalResult.turn;
        if (finalTurn.kind === 'answer') {
          finalizedBy = 'model';
          // Finalize candidates stay buffered inside the adapter and are committed only
          // after the Harness validates the terminal shape. This prevents an invalid
          // or tool-requesting finalizer from leaking draft text into the completed UI.
          await safeEmit({ type: 'message_delta', delta: finalTurn.text });
          return await modelFinish(finalTurn.text, 'answered');
        }
        const businessName = finalTurn.kind === 'market_query' ? 'market.query'
          : finalTurn.kind === 'drop_search' ? 'drops.search'
            : finalTurn.kind === 'account_snapshot' ? 'account.snapshot' : undefined;
        modelFailure = businessName
          ? { code: 'MODEL_BAD_RESPONSE', category: 'protocol', message: `最终汇总阶段模型仍请求业务工具 ${businessName}，已被执行门禁拒绝；未执行任何工具。`, retryable: false }
          : { code: 'MODEL_BAD_RESPONSE', category: 'protocol', message: '最终汇总阶段模型输出非法；已按门禁拒绝，未重试。', retryable: false };
        await safeEmit({ type: 'model_error', error: modelFailure });
        finalizedBy = 'harness';
        return await deterministicFinish();
      } catch (error) {
        if (error instanceof ModelAdapterError && error.failure.code !== 'MODEL_CANCELLED') {
          modelFailure = error.failure;
          await safeEmit({ type: 'model_error', error: error.failure });
          finalizedBy = 'harness';
          return await deterministicFinish();
        }
        if (error instanceof PhaseTimeoutError) {
          modelFailure = { code: 'MODEL_TIMEOUT', category: 'upstream', message: '最终汇总模型请求超时；已按已有证据程序收束。', retryable: true };
          await safeEmit({ type: 'model_error', error: modelFailure });
          finalizedBy = 'harness';
          return await deterministicFinish();
        }
        throw error;
      }
    };

    let turnResult: ModelTurnResult;
    for (;;) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      // 预算边界：达到第 15 次观察、模型请求预留耗尽、越过软截止点或 token
      // 预算耗尽时，不再发起正常决策，进入受限最终汇总（或直接程序收束）。
      if (toolAttempts >= policy.maxToolAttempts
        || (toolRounds.length > 0 && modelRequestsUsed >= policy.maxModelRequests - 1)
        || now() >= softDeadlineAt
        || tokenBudgetExceeded()) {
        return await enterFinalize();
      }
      if (toolRounds.length > 0) await emit(deps, { type: 'status', phase: 'composing', text: '正在把工具结果回送模型生成回答' });
      const requestTimeoutMs = Math.min(policy.modelRequestTimeoutMs, Math.max(1, remainingUntil(deadlineAt)));
      modelRequestsUsed += 1;
      // Each model request owns its own streaming buffer. Text from a previous
      // decision must not suppress or contaminate a later answer.
      let streamedText = '';
      const onTextDelta = async (delta: string) => {
        streamedText += delta;
        await emit(deps, { type: 'message_delta', delta });
      };
      try {
        turnResult = await runPhase('model', requestTimeoutMs, (signal) => adapter.generateTurn({
          message: request.message,
          signal,
          ...(defaults ? { defaults } : {}),
          ...(toolRounds.length ? { history: toolRounds } : {}),
          onTextDelta,
          mode: 'decide',
        }, profile));
      } catch (error) {
        if (error instanceof ModelAdapterError && error.failure.code !== 'MODEL_CANCELLED') {
          modelFailure = error.failure;
          if (toolRounds.length === 0) {
            facts = [{ key: 'model.error_code', value: error.failure.code }, { key: 'model.error_retryable', value: error.failure.retryable }];
            await safeEmit({ type: 'model_error', error: error.failure });
            return await finish(error.failure.message, 'answer', 'error');
          }
          await safeEmit({ type: 'model_error', error: error.failure });
          return await deterministicFinish();
        }
        if (error instanceof PhaseTimeoutError) {
          const failure: ModelFailure = { code: 'MODEL_TIMEOUT', category: 'upstream', message: '模型请求超时；本轮已停止，未执行后续操作。', retryable: true };
          modelFailure = failure;
          await safeEmit({ type: 'model_error', error: failure });
          if (toolRounds.length === 0) return await finish(failure.message, 'answer', 'timeout', undefined, undefined, undefined, failure);
          return await deterministicFinish({ terminalReason: 'timeout' });
        }
        throw error;
      }
      if (controller.signal.aborted) throw abortError(controller.signal);
      const turn = turnResult.turn;
      if (turnResult.usage) usage = addUsage(usage, turnResult.usage);
      if (turnResult.finishReason) finishReason = turnResult.finishReason;
      if (toolRounds.length === 0) {
        // 首轮：允许 answer / clarify / conclude 等 v1 决策直接结束本轮。
        if (turn.kind === 'answer') {
          if (!turn.streamed || streamedText.length === 0) await emit(deps, { type: 'message_delta', delta: turn.text });
          return await finish(turn.text, 'answer');
        }
        if (turn.kind === 'clarify' && request.askScopeIfMissing && isMissingMarketScope(turn)) {
          // 兜底路径：预检未命中（例如意图口径外的消息）但 adapter 仍以结构化
          // clarify 报告缺范围时，仍给同一次可点击选择卡，行为与预检一致。
          const prompt = SCOPE_CHOICE_PROMPT;
          await emit(deps, {
            type: 'scope_choice_required',
            questionId: `scope-${request.requestId}`,
            prompt,
            options: MARKET_SCOPE_OPTIONS.map((option) => ({ ...option })),
          });
          facts = turn.facts;
          await emit(deps, { type: 'message_delta', delta: prompt });
          return await finish(prompt, 'clarify');
        }
        if (turn.kind === 'clarify') { facts = turn.facts; await emit(deps, { type: 'message_delta', delta: turn.text }); return await finish(turn.text, 'clarify'); }
        if (turn.kind === 'conclude') {
          await emit(deps, { type: 'model_error', error: { code: 'MODEL_BAD_RESPONSE', category: 'protocol', message: '模型在工具执行前提交了终态。', retryable: false } });
          return await finish('模型在工具执行前提交了终态，属于协议错误。', 'answer', 'error');
        }
      } else if (turn.kind === 'answer') {
        if (!turn.streamed || streamedText.length === 0) await emit(deps, { type: 'message_delta', delta: turn.text });
        return await modelFinish(turn.text, 'answered');
      } else if (turn.kind === 'conclude' && turn.conclusion === 'answered') {
        await emit(deps, { type: 'status', phase: 'composing', text: '正在采用模型提交的终态回答' });
        for (const delta of turn.text.match(/.{1,24}/gu) ?? []) await emit(deps, { type: 'message_delta', delta });
        return await modelFinish(turn.text, 'answered');
      } else if (turn.kind === 'conclude' && turn.conclusion === 'insufficient_data' && !lastOk) {
        await emit(deps, { type: 'status', phase: 'composing', text: '模型声明数据不足，采用确定性工具结果' });
        for (const delta of lastText.match(/.{1,24}/gu) ?? []) await emit(deps, { type: 'message_delta', delta });
        return await modelFinish(lastText, 'insufficient_data');
      } else if (turn.kind === 'clarify' || (turn.kind === 'conclude' && turn.conclusion === 'insufficient_data')) {
        // 工具成功后声明数据不足、工具后澄清等都属于终态滥用，回落 Harness 确定性回答。
        return await deterministicFinish();
      }
      // 业务工具（首轮与回送轮都可能出现）：执行前仍走归一化与契约校验。
      if (turn.kind === 'market_query') {
        // 程序归一化（模型无关）：任何 adapter 给出的范围都不能覆盖本条消息的
        // 明确条件或已保存偏好；缺省等级由程序补 0，不依赖模型遵守提示词。
        const explicitScope = marketScopeFromMessage(request.message);
        if (explicitScope.rank === null) {
          // 用户明确给出非法等级（如“负3级”）：模型若未按契约澄清而仍提交
          // market_query（例如默认成 0 级），Harness 也必须程序化文本澄清，
          // 不得把非法条件静默归一化后执行。
          const text = '等级必须是非负整数或 max。';
          facts = [{ key: 'invalid_field', value: 'rank' }];
          await emit(deps, { type: 'message_delta', delta: text });
          return await finish(text, 'clarify');
        }
        const normalized = normalizeMarketQueryRequest(turn.request, request.message, request.defaults);
        // 保留并执行严格契约校验：归一化结果仍必须通过 MarketQueryRequest 校验。
        try {
          assertMarketQueryRequest(normalized);
        } catch {
          return await finish('市场查询参数不合法，已停止本轮，未执行任何查询。', 'answer', 'error');
        }
        toolCalls.push({ name: 'market.query', arguments: { ...normalized } });
        await emit(deps, { type: 'status', phase: 'tool', text: '正在查询公开市场快照' });
        await emit(deps, { type: 'tool_call', name: 'market.query', arguments: normalized });
        // Count on entry to the domain executor: a cancelled, timed-out, or
        // throwing attempt still consumed the run's tool budget.
        toolAttempts += 1;
        const result = await runPhase('tool', Math.min(policy.toolTimeoutMs, Math.max(1, remainingUntil(deadlineAt))),
          (signal) => deps.marketQuery(normalized, signal));
        if (controller.signal.aborted) throw abortError(controller.signal);
        await emit(deps, { type: 'tool_result', name: 'market.query', ok: result.ok, summary: result.ok ? result.evidence.finding : result.error.code });
        facts = marketFacts(result);
        lastText = responseFor(result);
        lastOk = result.ok;
        toolRounds.push({
          toolName: 'market.query',
          toolCall: { ...normalized },
          toolResultSummary: marketToolSummary(result),
          ...(turnResult.reasoning ? { assistantReasoning: turnResult.reasoning } : {}),
        });
      } else if (turn.kind === 'drop_search') {
        toolCalls.push({ name: 'drops.search', arguments: { ...turn.request } });
        await emit(deps, { type: 'status', phase: 'tool', text: '正在读取版本化公共掉落快照' });
        await emit(deps, { type: 'tool_call', name: 'drops.search', arguments: turn.request });
        if (!deps.searchDrops) return await finish('本地掉落数据服务尚未配置。', 'answer', 'error');
        toolAttempts += 1;
        const result = await runPhase('tool', Math.min(policy.toolTimeoutMs, Math.max(1, remainingUntil(deadlineAt))),
          (signal) => deps.searchDrops!(turn.request, signal));
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
        toolRounds.push({
          toolName: 'drops.search',
          toolCall: { ...turn.request },
          toolResultSummary: dropToolSummary(result),
          ...(turnResult.reasoning ? { assistantReasoning: turnResult.reasoning } : {}),
        });
      } else if (turn.kind === 'account_snapshot') {
        // 模型工具选择不可作为授权依据。即使初始文本没有命中个人数据关键词，
        // 也必须在实际读取前再次执行不可绕过的频道与主人身份门禁。
        const denied = personalScopeRefusal(request);
        if (denied) {
          await emit(deps, { type: 'message_delta', delta: denied.text });
          return await finish(denied.text, 'refuse', 'completed', denied.reason);
        }
        toolCalls.push({ name: 'account.snapshot', arguments: { ...turn.request } });
        await emit(deps, { type: 'status', phase: 'tool', text: '正在读取本机账号快照摘要' });
        await emit(deps, { type: 'tool_call', name: 'account.snapshot', arguments: turn.request });
        if (!deps.getSnapshot) return await finish('个人快照服务尚未配置；当前版本不读取本机账号数据。', 'answer', 'error');
        toolAttempts += 1;
        const result = await runPhase('tool', Math.min(policy.toolTimeoutMs, Math.max(1, remainingUntil(deadlineAt))),
          (signal) => deps.getSnapshot!(turn.request, signal));
        if (controller.signal.aborted) throw abortError(controller.signal);
        await emit(deps, { type: 'tool_result', name: 'account.snapshot', ok: result.ok, summary: result.ok ? result.evidence.finding : result.error.code });
        facts = accountFacts(result);
        lastText = accountResponseFor(result);
        lastOk = result.ok;
        toolRounds.push({
          toolName: 'account.snapshot',
          toolCall: { ...turn.request },
          toolResultSummary: accountToolSummary(result),
          ...(turnResult.reasoning ? { assistantReasoning: turnResult.reasoning } : {}),
        });
      }
      // 普通任务提前 answer/conclude 已在上面直接提交，不附加固定反思；只有
      // 未声明工具回送的 adapter 在这里走确定性收束（本地规则后端）。
      if (!adapter.supportsToolRoundTrip) return await deterministicFinish();
    }
  } catch (error) {
    const hardTimedOut = controller.signal.reason instanceof Error && controller.signal.reason.message === 'timeout';
    if (error instanceof ModelAdapterError && error.failure.code !== 'MODEL_CANCELLED') {
      facts = [{ key: 'model.error_code', value: error.failure.code }, { key: 'model.error_retryable', value: error.failure.retryable }];
      await safeEmit({ type: 'model_error', error: error.failure });
      return await finish(error.failure.message, 'answer', 'error');
    }
    if (error instanceof PhaseTimeoutError) {
      const failure: ModelFailure = {
        code: 'MODEL_TIMEOUT', category: 'upstream', retryable: true,
        message: error.phase === 'tool' ? '领域工具执行超时；本轮已停止，未执行后续操作。' : '模型请求超时；本轮已停止，未执行后续操作。',
      };
      modelFailure = failure;
      await safeEmit({ type: 'model_error', error: failure });
      if (toolRounds.length === 0) return await finish(failure.message, 'answer', 'timeout', undefined, undefined, undefined, failure);
      return await deterministicFinish({ terminalReason: 'timeout' });
    }
    const message = hardTimedOut ? '本轮 Agent 已超时停止，可调整请求后重试。' : '本轮 Agent 已停止；未继续执行或提交任何写操作。';
    return await finish(message, 'answer', hardTimedOut ? 'timeout' : 'cancelled');
  } finally {
    clearTimeout(timeoutHandle);
    deps.signal?.removeEventListener('abort', forwardAbort);
  }
}

export {
  ACCOUNT_SNAPSHOT_CONTRACT_VERSION,
  type AccountSnapshotErrorCode,
  type AccountSnapshotEvidence,
  type AccountSnapshotFailure,
  type AccountSnapshotFinding,
  type AccountSnapshotItem,
  type AccountSnapshotRequest,
  type AccountSnapshotResult,
  type AccountSnapshotSuccess,
  type AccountTotals,
} from './account-snapshot.js';
export {
  OPENAI_COMPATIBLE_ADAPTER_ID,
  createOpenAICompatibleAdapter,
  createOpenAICompatibleProfile,
  type CredentialResolver,
  type ModelFetch,
  type OpenAICompatibleAdapterOptions,
  type OpenAICompatibleProfileInput,
} from './openai-compatible.js';
export {
  MARKET_SCOPE_OPTIONS,
  SCOPE_CHOICE_PROMPT,
  isNaturalMarketPriceQuery,
  marketScopeFromMessage,
  marketScopeMissing,
  normalizeMarketQueryRequest,
  scopeChoiceRequired,
  type ExplicitMarketScope,
  type MarketScopeOption,
} from './market-scope.js';
export {
  DEFAULT_RUN_POLICY,
  resolveRunPolicy,
  type RunPolicy,
} from './run-policy.js';
