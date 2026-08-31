import { assertMarketQueryRequest, MARKET_QUERY_CONTRACT_VERSION, type MarketQueryRequest } from '@warframe-companion/market-query-contract';
import { DROP_SEARCH_CONTRACT_VERSION, type DropSearchRequest } from '@warframe-companion/warframe-data-service';
import {
  ACCOUNT_SNAPSHOT_CONTRACT_VERSION,
  type AccountSnapshotRequest,
} from './account-snapshot.js';
import {
  ModelAdapterError,
  OPENAI_COMPATIBLE_CONFIG_VERSION,
  type CredentialReference,
  type ModelAdapter,
  type ModelCapabilities,
  type ModelFailure,
  type ModelFinishReason,
  type ModelProfile,
  type ModelTurn,
  type ModelTurnResult,
  type ModelUsage,
  type OpenAICompatibleConfiguration,
  type ToolRoundStep,
} from './index.js';

export const OPENAI_COMPATIBLE_ADAPTER_ID = 'openai-compatible' as const;
export interface OpenAICompatibleProfileInput {
  id: string;
  label: string;
  model: string;
  description?: string;
  capabilities: ModelCapabilities;
  configuration: OpenAICompatibleConfiguration;
}
export type ModelFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type CredentialResolver = (reference: CredentialReference) => Promise<string | undefined>;
export interface OpenAICompatibleAdapterOptions {
  fetch?: ModelFetch;
  resolveCredential?: CredentialResolver;
  healthTimeoutMs?: number;
}

const SAFE_ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const SAFE_PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * 逻辑工具名 → 线上工具名。部分 OpenAI-compatible 服务（实测 DeepSeek）要求
 * 工具名只匹配 ^[a-zA-Z0-9_-]+$，不允许点号；内部逻辑名（market.query 等）
 * 保持不变，只在 wire 层做映射。
 */
const WIRE_TOOL_NAMES = {
  'market.query': 'market_query',
  'drops.search': 'drop_search',
  'account.snapshot': 'account_snapshot',
  'agent.clarify': 'agent_clarify',
  'agent.conclude': 'agent_conclude',
} as const;
type WireToolName = (typeof WIRE_TOOL_NAMES)[keyof typeof WIRE_TOOL_NAMES];
function wireToolName(logical: 'market.query' | 'drops.search' | 'account.snapshot' | 'agent.clarify' | 'agent.conclude'): WireToolName {
  return WIRE_TOOL_NAMES[logical];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function configurationFailure(message: string): ModelFailure {
  return { code: 'MODEL_CONFIG_INVALID', category: 'configuration', message, retryable: false };
}
function normalizeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ModelAdapterError(configurationFailure('模型 Base URL 不是有效 URL。')); }
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname === '::1' ? '[::1]' : url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new ModelAdapterError(configurationFailure('模型 Base URL 必须使用 HTTPS；本机回环地址可使用 HTTP。'));
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ModelAdapterError(configurationFailure('模型 Base URL 不得包含凭据、查询参数或片段。'));
  }
  return url.toString().replace(/\/$/u, '');
}
function validateCapabilities(value: unknown): ModelCapabilities {
  const data = record(value);
  const booleanKeys = ['text', 'vision', 'nativeTools', 'structuredOutput', 'reasoning', 'streaming', 'cancellation'] as const;
  if (!data || !exactKeys(data, [...booleanKeys, 'contextWindow'])
    || booleanKeys.some((key) => typeof data[key] !== 'boolean')
    || !Number.isInteger(data.contextWindow) || Number(data.contextWindow) < 1_024 || Number(data.contextWindow) > 2_000_000) {
    throw new ModelAdapterError(configurationFailure('模型能力声明格式无效。'));
  }
  return data as unknown as ModelCapabilities;
}
function validateCredential(value: unknown): CredentialReference {
  const data = record(value);
  if (!data || typeof data.kind !== 'string') throw new ModelAdapterError(configurationFailure('凭据引用格式无效。'));
  if (data.kind === 'none' && exactKeys(data, ['kind'])) return { kind: 'none' };
  if (data.kind === 'environment' && exactKeys(data, ['kind', 'variable']) && typeof data.variable === 'string' && SAFE_ENV_NAME.test(data.variable)) {
    return { kind: 'environment', variable: data.variable };
  }
  throw new ModelAdapterError(configurationFailure('凭据只能引用大写环境变量名，不能保存密钥值。'));
}
function validateConfiguration(value: unknown): OpenAICompatibleConfiguration {
  const data = record(value);
  if (!data || !exactKeys(data, ['configVersion', 'baseUrl', 'api', 'healthCheck', 'credential', 'maxOutputTokens'])
    || data.configVersion !== OPENAI_COMPATIBLE_CONFIG_VERSION || data.api !== 'chat_completions' || data.healthCheck !== 'models'
    || typeof data.baseUrl !== 'string' || data.baseUrl.length > 2_048
    || !Number.isInteger(data.maxOutputTokens) || Number(data.maxOutputTokens) < 64 || Number(data.maxOutputTokens) > 32_768) {
    throw new ModelAdapterError(configurationFailure('OpenAI-compatible 配置格式无效。'));
  }
  return {
    configVersion: OPENAI_COMPATIBLE_CONFIG_VERSION,
    baseUrl: normalizeBaseUrl(data.baseUrl),
    api: 'chat_completions',
    healthCheck: 'models',
    credential: validateCredential(data.credential),
    maxOutputTokens: Number(data.maxOutputTokens),
  };
}

export function createOpenAICompatibleProfile(value: unknown): ModelProfile {
  const data = record(value);
  if (!data || !exactKeys(data, ['id', 'label', 'model', 'description', 'capabilities', 'configuration'])
    || typeof data.id !== 'string' || !SAFE_PROFILE_ID.test(data.id)
    || typeof data.label !== 'string' || !data.label.trim() || data.label.length > 80
    || typeof data.model !== 'string' || !data.model.trim() || data.model.length > 200
    || (data.description !== undefined && (typeof data.description !== 'string' || data.description.length > 240))) {
    throw new ModelAdapterError(configurationFailure('本机模型 profile 的标识、名称或模型字段无效。'));
  }
  return {
    id: data.id,
    label: data.label.trim(),
    adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
    model: data.model.trim(),
    description: typeof data.description === 'string' && data.description.trim()
      ? data.description.trim()
      : '本机配置的 OpenAI-compatible 模型；凭据仅保存引用。',
    capabilities: validateCapabilities(data.capabilities),
    source: 'local_config',
    configuration: validateConfiguration(data.configuration),
  };
}

function failure(code: ModelFailure['code'], message: string, retryable: boolean, retryAfterMs?: number): ModelFailure {
  const category: ModelFailure['category'] = code === 'MODEL_CONFIG_INVALID' || code === 'MODEL_CREDENTIAL_UNAVAILABLE' || code === 'MODEL_CAPABILITY_MISMATCH'
    ? 'configuration' : code === 'MODEL_AUTH_REJECTED' ? 'authentication'
      : code === 'MODEL_BAD_RESPONSE' ? 'protocol' : code === 'MODEL_CANCELLED' ? 'cancelled' : 'upstream';
  return { code, category, message, retryable, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
}
function retryAfter(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
function httpFailure(response: Response): ModelFailure {
  if (response.status === 401 || response.status === 403) return failure('MODEL_AUTH_REJECTED', '模型服务拒绝了凭据引用；请检查本机环境变量和服务权限。', false);
  if (response.status === 429) return failure('MODEL_RATE_LIMITED', '模型服务当前限流，可以稍后重试。', true, retryAfter(response));
  if (response.status === 408 || response.status === 504) return failure('MODEL_TIMEOUT', '模型服务响应超时，可以稍后重试。', true);
  return failure('MODEL_UNAVAILABLE', `模型服务当前不可用（HTTP ${response.status}）。`, response.status >= 500);
}
async function defaultCredentialResolver(reference: CredentialReference): Promise<string | undefined> {
  return reference.kind === 'environment' ? process.env[reference.variable] : undefined;
}
async function credentialHeaders(configuration: OpenAICompatibleConfiguration, resolver: CredentialResolver): Promise<Record<string, string>> {
  if (configuration.credential.kind === 'none') return {};
  const value = await resolver(configuration.credential);
  if (!value) throw new ModelAdapterError(failure('MODEL_CREDENTIAL_UNAVAILABLE', `凭据环境变量 ${configuration.credential.variable} 未提供。`, false));
  return { authorization: `Bearer ${value}` };
}
function profileConfiguration(profile: ModelProfile): OpenAICompatibleConfiguration {
  if (profile.adapterId !== OPENAI_COMPATIBLE_ADAPTER_ID || !profile.configuration) {
    throw new ModelAdapterError(configurationFailure('profile 未绑定 OpenAI-compatible 配置。'));
  }
  return validateConfiguration(profile.configuration);
}
function endpoint(configuration: OpenAICompatibleConfiguration, resource: 'models' | 'chat/completions'): string {
  return `${configuration.baseUrl}/${resource}`;
}
async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await response.json(); } catch { throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型服务返回了无效 JSON。', false)); }
  const data = record(value);
  if (!data) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型服务返回结构无效。', false));
  return data;
}
function parseUsage(value: unknown): ModelUsage | undefined {
  const data = record(value);
  if (!data) return undefined;
  const token = (entry: unknown): number | undefined =>
    typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 ? entry : undefined;
  const promptTokens = token(data.prompt_tokens);
  const completionTokens = token(data.completion_tokens);
  const totalTokens = token(data.total_tokens);
  if (promptTokens === undefined || completionTokens === undefined || totalTokens === undefined) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}
function finishReasonOf(choice: Record<string, unknown> | undefined): ModelFinishReason | undefined {
  return typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;
}
function parseToolTurn(name: unknown, rawArguments: unknown): ModelTurn {
  if (typeof name !== 'string' || typeof rawArguments !== 'string') throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型工具调用缺少函数名或 JSON 参数。', false));
  let args: unknown;
  try { args = JSON.parse(rawArguments); } catch { throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型工具调用参数不是有效 JSON。', false)); }
  if (name === wireToolName('market.query')) {
    try { assertMarketQueryRequest(args); } catch { throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型生成的 market.query 参数不符合契约。', false)); }
    return { kind: 'market_query', request: args as MarketQueryRequest };
  }
  if (name === wireToolName('drops.search')) {
    const data = record(args);
    if (!data || !exactKeys(data, ['contractVersion', 'item', 'limit']) || data.contractVersion !== DROP_SEARCH_CONTRACT_VERSION
      || typeof data.item !== 'string' || !data.item.trim() || data.item.length > 200
      || (data.limit !== undefined && (!Number.isInteger(data.limit) || Number(data.limit) < 1 || Number(data.limit) > 100))) {
      throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型生成的 drops.search 参数不符合契约。', false));
    }
    return { kind: 'drop_search', request: data as unknown as DropSearchRequest };
  }
  if (name === wireToolName('account.snapshot')) {
    const data = record(args);
    if (!data || !exactKeys(data, ['contractVersion', 'item'])
      || data.contractVersion !== ACCOUNT_SNAPSHOT_CONTRACT_VERSION
      || (data.item !== undefined && (typeof data.item !== 'string' || !data.item.trim() || data.item.length > 120))) {
      throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型生成的 account.snapshot 参数不符合契约。', false));
    }
    return {
      kind: 'account_snapshot',
      request: { contractVersion: ACCOUNT_SNAPSHOT_CONTRACT_VERSION, ...(data.item ? { item: data.item } : {}) } as AccountSnapshotRequest,
    };
  }
  if (name === wireToolName('agent.clarify')) {
    const data = record(args);
    if (!data || !exactKeys(data, ['text', 'field', 'reason']) || typeof data.text !== 'string' || !data.text.trim()
      || typeof data.field !== 'string' || !data.field.trim() || !['missing', 'invalid'].includes(String(data.reason))) {
      throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型生成的澄清参数不符合契约。', false));
    }
    return { kind: 'clarify', text: data.text.trim(), facts: [{ key: data.reason === 'invalid' ? 'invalid_field' : 'missing_field', value: data.field }] };
  }
  if (name === wireToolName('agent.conclude')) {
    const data = record(args);
    if (!data || !exactKeys(data, ['text', 'conclusion']) || typeof data.text !== 'string' || !data.text.trim()
      || !['answered', 'insufficient_data'].includes(String(data.conclusion))) {
      throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型提交的终态参数不符合契约。', false));
    }
    return { kind: 'conclude', text: data.text.trim(), conclusion: data.conclusion as 'answered' | 'insufficient_data' };
  }
  throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', `模型请求了未注册工具 ${name}。`, false));
}
function parseMessageTurn(message: unknown): ModelTurn {
  const data = record(message);
  if (!data) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型响应缺少 message。', false));
  if (Array.isArray(data.tool_calls)) {
    if (data.tool_calls.length !== 1) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '当前单轮只允许一个结构化工具调用。', false));
    const call = record(data.tool_calls[0]);
    const fn = record(call?.function);
    return parseToolTurn(fn?.name, fn?.arguments);
  }
  if (typeof data.content !== 'string' || !data.content.trim()) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型响应既没有工具调用，也没有文本。', false));
  return { kind: 'answer', text: data.content };
}
async function parseNonStreaming(response: Response): Promise<ModelTurnResult> {
  const payload = await parseJsonResponse(response);
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length !== 1) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型响应 choices 数量无效。', false));
  const choice = record(choices[0]);
  const message = record(choice?.message);
  const usage = parseUsage(payload.usage);
  const finishReason = finishReasonOf(choice ?? undefined);
  const reasoning = typeof message?.reasoning_content === 'string' ? message.reasoning_content : undefined;
  return {
    turn: parseMessageTurn(message),
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}
async function parseStreaming(response: Response, onDelta?: (delta: string) => void | Promise<void>): Promise<ModelTurnResult> {
  if (!response.body) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型声明流式响应但没有响应体。', false));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let reasoning = '';
  let usage: ModelUsage | undefined;
  let finishReason: ModelFinishReason | undefined;
  const calls = new Map<number, { name: string; arguments: string }>();
  const consume = async (block: string) => {
    const payloadText = block.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!payloadText || payloadText === '[DONE]') return;
    let payload: unknown;
    try { payload = JSON.parse(payloadText); } catch { throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型 SSE 数据不是有效 JSON。', false)); }
    const payloadRecord = record(payload);
    const choices = payloadRecord?.choices;
    if (!Array.isArray(choices) || choices.length !== 1) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型 SSE choices 数量无效。', false));
    const choice = record(choices[0]);
    if (choice) {
      const rawFinish = choice.finish_reason;
      if (typeof rawFinish === 'string') finishReason = rawFinish;
    }
    const parsedUsage = parseUsage(payloadRecord?.usage);
    if (parsedUsage) usage = parsedUsage;
    const delta = record(choice?.delta);
    if (!delta) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型 SSE 缺少 delta。', false));
    if (typeof delta.content === 'string' && delta.content) { text += delta.content; await onDelta?.(delta.content); }
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) reasoning += delta.reasoning_content;
    if (Array.isArray(delta.tool_calls)) for (const rawCall of delta.tool_calls) {
      const call = record(rawCall);
      const index = Number(call?.index);
      const fn = record(call?.function);
      if (!Number.isInteger(index) || index < 0 || !fn) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型 SSE 工具调用片段无效。', false));
      const current = calls.get(index) ?? { name: '', arguments: '' };
      if (typeof fn.name === 'string') current.name += fn.name;
      if (typeof fn.arguments === 'string') current.arguments += fn.arguments;
      calls.set(index, current);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/gu, '\n');
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); await consume(block);
    }
    if (done) break;
  }
  if (buffer.trim()) await consume(buffer);
  if (calls.size) {
    if (calls.size !== 1 || !calls.has(0)) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '当前单轮只允许一个结构化工具调用。', false));
    const call = calls.get(0)!;
    return {
      turn: parseToolTurn(call.name, call.arguments),
      ...(usage ? { usage } : {}),
      ...(finishReason ? { finishReason } : {}),
      ...(reasoning ? { reasoning } : {}),
    };
  }
  if (!text.trim()) throw new ModelAdapterError(failure('MODEL_BAD_RESPONSE', '模型流式响应没有文本或工具调用。', false));
  return {
    turn: { kind: 'answer', text, streamed: true },
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

const TOOLS = [
  {
    type: 'function', function: {
      name: wireToolName('market.query'), description: '查询 Warframe.Market 当前公开挂单。平台、跨平台范围和等级必须显式给出。',
      parameters: {
        type: 'object', additionalProperties: false, required: ['contractVersion', 'item', 'platform', 'crossplay', 'rank'],
        properties: {
          contractVersion: { type: 'string', const: MARKET_QUERY_CONTRACT_VERSION }, item: { type: 'string', minLength: 1 },
          platform: { type: 'string', enum: ['pc', 'ps4', 'xbox', 'switch', 'mobile'] }, crossplay: { type: 'boolean' },
          rank: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'string', const: 'max' }] },
        },
      },
    },
  },
  {
    type: 'function', function: {
      name: wireToolName('drops.search'), description: '查询版本化 WFCD 公共掉落表。',
      parameters: {
        type: 'object', additionalProperties: false, required: ['contractVersion', 'item'],
        properties: { contractVersion: { type: 'string', const: DROP_SEARCH_CONTRACT_VERSION }, item: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      },
    },
  },
  {
    type: 'function', function: {
      name: wireToolName('account.snapshot'), description: '读取本机账号快照的脱敏摘要（段位/白金/杜卡德/现金/物品数量）。只读；模型不得索取原始快照、实例 ID 或账号标识。',
      parameters: {
        type: 'object', additionalProperties: false, required: ['contractVersion'],
        properties: { contractVersion: { type: 'string', const: ACCOUNT_SNAPSHOT_CONTRACT_VERSION }, item: { type: 'string', minLength: 1, maxLength: 120 } },
      },
    },
  },
  {
    type: 'function', function: {
      name: wireToolName('agent.clarify'), description: '市场查询缺少必需范围或参数无效时，用结构化澄清结束本轮；这不是外部工具。',
      parameters: {
        type: 'object', additionalProperties: false, required: ['text', 'field', 'reason'],
        properties: { text: { type: 'string', minLength: 1 }, field: { type: 'string', minLength: 1 }, reason: { type: 'string', enum: ['missing', 'invalid'] } },
      },
    },
  },
  {
    type: 'function', function: {
      name: wireToolName('agent.conclude'), description: '至少一个工具已执行后提交本轮终态：answered 表示已基于工具结果作答；insufficient_data 表示工具结果不足以作答。不得提交事实、身份、拒绝、延迟或调用次数。',
      parameters: {
        type: 'object', additionalProperties: false, required: ['text', 'conclusion'],
        properties: { text: { type: 'string', minLength: 1 }, conclusion: { type: 'string', enum: ['answered', 'insufficient_data'] } },
      },
    },
  },
] as const;

export function createOpenAICompatibleAdapter(options: OpenAICompatibleAdapterOptions = {}): ModelAdapter {
  const fetcher = options.fetch ?? globalThis.fetch;
  const resolver = options.resolveCredential ?? defaultCredentialResolver;
  return {
    id: OPENAI_COMPATIBLE_ADAPTER_ID,
    adapterVersion: 1,
    supportsToolRoundTrip: true,
    async checkHealth(profile, externalSignal) {
      let configuration: OpenAICompatibleConfiguration;
      try { configuration = profileConfiguration(profile); }
      catch (error) {
        const modelError = error instanceof ModelAdapterError ? error : new ModelAdapterError(configurationFailure('模型配置无效。'));
        return { available: false, summary: modelError.failure.message, error: modelError.failure };
      }
      let headers: Record<string, string>;
      try { headers = await credentialHeaders(configuration, resolver); }
      catch (error) {
        const modelError = error as ModelAdapterError;
        return { available: false, summary: modelError.failure.message, error: modelError.failure };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('health timeout')), options.healthTimeoutMs ?? 5_000);
      const forward = () => controller.abort(externalSignal?.reason);
      externalSignal?.addEventListener('abort', forward, { once: true });
      try {
        const response = await fetcher(endpoint(configuration, 'models'), { method: 'GET', headers, signal: controller.signal });
        if (!response.ok) { const error = httpFailure(response); return { available: false, summary: error.message, error }; }
        const payload = await parseJsonResponse(response);
        if (!Array.isArray(payload.data)) { const error = failure('MODEL_BAD_RESPONSE', '健康检查响应不符合 OpenAI /models 契约。', false); return { available: false, summary: error.message, error }; }
        const listed = payload.data.some((entry) => record(entry)?.id === profile.model);
        return { available: true, summary: listed ? 'OpenAI-compatible /models 健康检查通过，已找到所选模型。' : 'OpenAI-compatible /models 可达；所选模型未在列表中，发送前请确认服务端别名。' };
      } catch (error) {
        if (error instanceof ModelAdapterError) return { available: false, summary: error.failure.message, error: error.failure };
        const timedOut = controller.signal.aborted && !externalSignal?.aborted;
        const mapped = failure(timedOut ? 'MODEL_TIMEOUT' : externalSignal?.aborted ? 'MODEL_CANCELLED' : 'MODEL_UNAVAILABLE', timedOut ? '模型健康检查超时。' : externalSignal?.aborted ? '模型健康检查已取消。' : '无法连接模型服务。', timedOut || !externalSignal?.aborted);
        return { available: false, summary: mapped.message, error: mapped };
      } finally {
        clearTimeout(timeout); externalSignal?.removeEventListener('abort', forward);
      }
    },
    async generateTurn(input, profile) {
      const configuration = profileConfiguration(profile);
      if (!profile.capabilities.nativeTools || !profile.capabilities.structuredOutput) {
        throw new ModelAdapterError(failure('MODEL_CAPABILITY_MISMATCH', '所选模型未声明结构化工具调用能力。', false));
      }
      const headers = { 'content-type': 'application/json', ...(await credentialHeaders(configuration, resolver)) };
      const defaults = input.defaults ? `\n调用方提供的显式默认参数：${JSON.stringify(input.defaults)}` : '';
      const messages: Array<Record<string, unknown>> = [
        { role: 'system', content: `你是只读 Warframe 工具路由器。需要实时行情或掉落事实时必须调用注册工具；禁止交易、聊天和账号写操作。缺少市场平台、跨平台范围或等级时直接用文本澄清，不得猜测。工具执行后必须基于脱敏的工具结果作答，并用 agent.conclude 提交终态；事实、证据、身份、延迟和拒绝永远由调用方决定，不得自行提交。${defaults}` },
        { role: 'user', content: input.message },
      ];
      (input.history ?? []).forEach((step: ToolRoundStep, index: number) => {
        messages.push({
          role: 'assistant', content: null,
          ...(step.assistantReasoning ? { reasoning_content: step.assistantReasoning } : {}),
          tool_calls: [{ id: `tool_round_${index}`, type: 'function', function: { name: wireToolName(step.toolName), arguments: JSON.stringify(step.toolCall) } }],
        });
        messages.push({ role: 'tool', tool_call_id: `tool_round_${index}`, content: step.toolResultSummary });
      });
      const body = {
        model: profile.model,
        stream: profile.capabilities.streaming,
        max_tokens: configuration.maxOutputTokens,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
      };
      let response: Response;
      try {
        response = await fetcher(endpoint(configuration, 'chat/completions'), { method: 'POST', headers, body: JSON.stringify(body), signal: input.signal });
      } catch {
        throw new ModelAdapterError(input.signal.aborted
          ? failure('MODEL_CANCELLED', '模型请求已取消。', false)
          : failure('MODEL_UNAVAILABLE', '无法连接模型服务。', true));
      }
      if (!response.ok) throw new ModelAdapterError(httpFailure(response));
      return profile.capabilities.streaming ? parseStreaming(response, input.onTextDelta) : parseNonStreaming(response);
    },
  };
}
