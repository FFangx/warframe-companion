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
}
export type AgentFactMode = 'none' | 'orders' | 'absent' | 'unavailable' | 'stale' | 'statistics' | 'split-orders' | 'basis' | 'snapshot' | 'failure';
export interface AgentRunRequest {
  requestId: string;
  message: string;
  context: { channel: 'desktop' | 'qq_private' | 'qq_group' | 'untrusted_test'; trustedOwner: boolean; now: string };
  evaluation?: { factMode: AgentFactMode; defaultMarketRequest?: MarketQueryRequest };
}
export type AgentStreamEvent =
  | { type: 'status'; phase: 'thinking' | 'tool' | 'composing'; text: string }
  | { type: 'tool_call'; name: 'market.query'; arguments: MarketQueryRequest }
  | { type: 'tool_result'; name: 'market.query'; ok: boolean; summary: string }
  | { type: 'message_delta'; delta: string }
  | { type: 'completed'; message: string; trace: AgentTrace };
export interface AgentRunDependencies {
  marketQuery(request: MarketQueryRequest): Promise<MarketQueryResult>;
  onEvent?(event: AgentStreamEvent): void | Promise<void>;
  now?: () => number;
}

function refusal(message: string, request: AgentRunRequest): { reason: RefusalReason; text: string } | null {
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

export async function runDesktopAgent(request: AgentRunRequest, deps: AgentRunDependencies): Promise<{ message: string; trace: AgentTrace }> {
  const started = deps.now?.() ?? Date.now();
  const elapsed = () => (deps.now?.() ?? Date.now()) - started;
  const toolCalls: ToolCallTrace[] = [];
  let facts: EvalFact[] = [];
  await emit(deps, { type: 'status', phase: 'thinking', text: '正在判断权限与工具需求' });
  const denied = refusal(request.message, request);
  if (denied) {
    const trace: AgentTrace = { caseId: request.requestId, decision: 'refuse', toolCalls, facts, refusalReason: denied.reason, latencyMs: elapsed() };
    await emit(deps, { type: 'message_delta', delta: denied.text }); await emit(deps, { type: 'completed', message: denied.text, trace });
    return { message: denied.text, trace };
  }
  if (!request.evaluation && /个人库存|我的库存|白金余额|个人白金|我的账号/u.test(request.message)) {
    const text = '桌面 Agent 当前尚未接入个人快照；本切片只支持公开市场查询。';
    const trace: AgentTrace = { caseId: request.requestId, decision: 'answer', toolCalls, facts, latencyMs: elapsed() };
    await emit(deps, { type: 'message_delta', delta: text }); await emit(deps, { type: 'completed', message: text, trace });
    return { message: text, trace };
  }
  if (!request.evaluation && !/查|查询|价格|行情|多少钱/u.test(request.message)) {
    const text = '桌面 Agent 当前只支持公开市场查询，请明确物品、平台、跨平台范围和等级。';
    const trace: AgentTrace = { caseId: request.requestId, decision: 'answer', toolCalls, facts, latencyMs: elapsed() };
    await emit(deps, { type: 'message_delta', delta: text }); await emit(deps, { type: 'completed', message: text, trace });
    return { message: text, trace };
  }
  const defaults = request.evaluation?.defaultMarketRequest;
  const rank = rankFrom(request.message);
  if (rank === null) {
    facts = [{ key: 'invalid_field', value: 'rank' }];
    const text = '等级必须是非负整数或 max。';
    const trace: AgentTrace = { caseId: request.requestId, decision: 'clarify', toolCalls, facts, latencyMs: elapsed() };
    await emit(deps, { type: 'message_delta', delta: text }); await emit(deps, { type: 'completed', message: text, trace }); return { message: text, trace };
  }
  const item = itemFrom(request.message) ?? defaults?.item;
  const platform = platformFrom(request.message) ?? defaults?.platform;
  const crossplay = /不跨平台|单平台/u.test(request.message) ? false : /跨平台/u.test(request.message) ? true : defaults?.crossplay;
  const resolvedRank = rank ?? defaults?.rank ?? (platform && crossplay !== undefined ? 0 : undefined);
  if (!item || !platform || crossplay === undefined || resolvedRank === undefined) {
    facts = [{ key: 'missing_field', value: 'platform,crossplay,rank' }];
    const text = '请明确平台、是否跨平台交易，以及等级（非负整数或 max）。';
    const trace: AgentTrace = { caseId: request.requestId, decision: 'clarify', toolCalls, facts, latencyMs: elapsed() };
    await emit(deps, { type: 'message_delta', delta: text }); await emit(deps, { type: 'completed', message: text, trace }); return { message: text, trace };
  }
  const marketRequest: MarketQueryRequest = { contractVersion: MARKET_QUERY_CONTRACT_VERSION, item, platform, crossplay, rank: resolvedRank };
  toolCalls.push({ name: 'market.query', arguments: { ...marketRequest } });
  await emit(deps, { type: 'status', phase: 'tool', text: '正在查询公开市场快照' }); await emit(deps, { type: 'tool_call', name: 'market.query', arguments: marketRequest });
  const result = await deps.marketQuery(marketRequest);
  await emit(deps, { type: 'tool_result', name: 'market.query', ok: result.ok, summary: result.ok ? result.evidence.finding : result.error.code });
  facts = factsFor(result, request.evaluation?.factMode ?? 'none');
  const text = responseFor(result);
  await emit(deps, { type: 'status', phase: 'composing', text: '正在按证据组织回答' });
  for (const delta of text.match(/.{1,24}/gu) ?? []) await emit(deps, { type: 'message_delta', delta });
  const trace: AgentTrace = { caseId: request.requestId, decision: 'call_tool', toolCalls, facts, latencyMs: elapsed() };
  await emit(deps, { type: 'completed', message: text, trace }); return { message: text, trace };
}
