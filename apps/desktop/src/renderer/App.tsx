import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  MARKET_PLATFORMS,
  MARKET_QUERY_CONTRACT_VERSION,
  type MarketOrder,
  type MarketPlatform,
  type MarketQueryFailure,
  type MarketQueryResult,
  type MarketQuerySuccess,
} from '@warframe-companion/market-query-contract';
import type { ComponentHealth, HealthStatus, SystemHealthSnapshot } from '../system-health.js';
import type { AgentStreamEvent, AgentTrace, ModelCapabilities, ModelHealth, ModelProfile, OpenAICompatibleProfileInput } from '@warframe-companion/agent-runtime';
import {
  ERROR_CATEGORY_LABELS,
  PLATFORM_LABELS,
  STATUS_LABELS,
  formatPlatinum,
  parseRankInput,
} from './market-presentation.js';

type View = 'health' | 'market' | 'agent';

const STATUS_COPY: Record<HealthStatus, { label: string; tone: string }> = {
  healthy: { label: '正常', tone: 'good' },
  degraded: { label: '降级', tone: 'warn' },
  unavailable: { label: '不可用', tone: 'bad' },
  not_configured: { label: '未配置', tone: 'idle' },
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium', timeStyle: 'medium', hour12: false,
  }).format(new Date(value));
}

function HealthCard({ component }: { component: ComponentHealth }) {
  const status = STATUS_COPY[component.status];
  return (
    <article className="health-card">
      <div className="health-card__topline">
        <div className="component-mark" aria-hidden="true">{component.label.slice(0, 1)}</div>
        <span className={`status status--${status.tone}`}><i />{status.label}</span>
      </div>
      <h2>{component.label}</h2>
      <p>{component.summary}</p>
      <dl>
        <div><dt>检查范围</dt><dd>{component.evidence.scope}</dd></div>
        <div><dt>来源</dt><dd>{component.evidence.source}</dd></div>
        <div><dt>时间</dt><dd>{formatTime(component.evidence.asOf)}</dd></div>
      </dl>
    </article>
  );
}

function HealthView() {
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSnapshot(await window.warframeCompanion.system.getHealth()); }
    catch { setError('无法读取本机健康快照。请重新检查桌面进程。'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const healthyCount = useMemo(
    () => snapshot?.components.filter((component) => component.status === 'healthy').length ?? 0,
    [snapshot],
  );

  return <>
    <header className="hero">
      <div><p className="eyebrow">LOCAL SYSTEM / HEALTH</p><h1>系统健康</h1><p className="hero__copy">一眼确认桌面端、本机集成与公共数据源是否处于可用状态。</p></div>
      <button className="refresh" type="button" onClick={() => void refresh()} disabled={loading}><span className={loading ? 'spin' : ''}>↻</span>{loading ? '检查中' : '重新检查'}</button>
    </header>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    <section className="summary" aria-live="polite">
      <div className={`summary__orb ${snapshot?.overall === 'healthy' ? 'summary__orb--good' : ''}`}><span /></div>
      <div><p>整体状态</p><strong>{loading && !snapshot ? '正在建立健康快照' : snapshot?.overall === 'healthy' ? '全部系统正常' : '部分能力需要关注'}</strong><small>{snapshot ? `${healthyCount} / ${snapshot.components.length} 项正常 · ${formatTime(snapshot.checkedAt)}` : '每项状态都来自本轮直接检查'}</small></div>
      <div className="summary__legend"><span>新鲜证据</span><span>本机只读</span><span>无账号操作</span></div>
    </section>
    <section className="health-grid">
      {snapshot?.components.map((component) => <HealthCard key={component.id} component={component} />)}
      {loading && !snapshot ? Array.from({ length: 5 }, (_, index) => <div className="health-card skeleton" key={index} />) : null}
    </section>
  </>;
}

function OrdersTable({ title, orders, side }: { title: string; orders: MarketOrder[]; side: 'sell' | 'buy' }) {
  return <section className="orders-panel">
    <div className="panel-title"><div><span className={`side-dot side-dot--${side}`} />{title}</div><small>{orders.length} 条 · 已按最优价格排序</small></div>
    {orders.length === 0 ? <div className="empty-orders">本次快照确认没有可见{title}</div> : <div className="order-list">
      {orders.map((order, index) => <div className="order-row" key={`${order.ingameName}-${order.updatedAt}-${index}`}>
        <div className="order-rank">{index + 1}</div>
        <div className="order-user"><strong>{order.ingameName}</strong><small><i className={`presence presence--${order.status}`} />{STATUS_LABELS[order.status]} · {PLATFORM_LABELS[order.platform]}</small></div>
        <div className="order-quantity">库存 {order.quantity}</div>
        <div className="order-price">{formatPlatinum(order.platinum)}</div>
      </div>)}
    </div>}
  </section>;
}

function MarketSuccessCard({ result }: { result: MarketQuerySuccess }) {
  const { item, sellOrders, buyOrders, statistics } = result.data;
  return <section className="market-result" aria-live="polite">
    <div className="result-heading">
      <div><p className="eyebrow">RESOLVED MARKET ITEM</p><h2>{item.name.zhHans}</h2><p>{item.name.en} · 等级 {item.rank.resolved}/{item.rank.maxRank}</p></div>
      <span className={`finding finding--${result.evidence.finding === 'confirmed_present' ? 'good' : 'empty'}`}>{result.evidence.finding === 'confirmed_present' ? '行情已确认' : '范围内无订单'}</span>
    </div>
    <div className="market-metrics">
      <div><span>90 日成交中位数</span><strong>{statistics ? formatPlatinum(statistics.median) : '不可用'}</strong><small>{statistics ? `${statistics.sampleSize} 笔样本` : '不影响当前挂单快照'}</small></div>
      <div><span>日均成交量</span><strong>{statistics ? statistics.dailyVolume.toLocaleString('zh-CN') : '—'}</strong><small>仅统计已成交订单</small></div>
      <div><span>交易税</span><strong>{item.tradingTax == null ? '未知' : item.tradingTax.toLocaleString('zh-CN')}</strong><small>{item.ducats == null ? '无杜卡德信息' : `${item.ducats} 杜卡德`}</small></div>
    </div>
    {result.warnings.length ? <div className="warning-strip">{result.warnings.map((warning) => <span key={warning.code}>△ {warning.message}</span>)}</div> : null}
    <div className="orders-grid"><OrdersTable title="卖单" orders={sellOrders} side="sell" /><OrdersTable title="买单" orders={buyOrders} side="buy" /></div>
    <div className="evidence-bar">
      <span><b>来源</b> Warframe.Market 公共接口</span><span><b>快照时间</b> {formatTime(result.evidence.asOf)}</span><span><b>有效至</b> {formatTime(result.evidence.expiresAt)}</span><span><b>范围</b> 当前挂单 · 直接快照</span>
    </div>
  </section>;
}

function MarketFailureCard({ result, onCandidate }: { result: MarketQueryFailure; onCandidate: (value: string) => void }) {
  return <section className="market-failure" role="alert">
    <div className="failure-icon">!</div>
    <div><p className="eyebrow">{result.error.code}</p><h2>{ERROR_CATEGORY_LABELS[result.error.category]}</h2><p>{result.error.message}</p>
      {result.error.details?.candidates?.length ? <div className="candidate-list"><span>请选择更准确的物品：</span>{result.error.details.candidates.map((candidate) => <button type="button" key={candidate.slug} onClick={() => onCandidate(candidate.name.zhHans)}>{candidate.name.zhHans}<small>{candidate.name.en}</small></button>)}</div> : null}
      <div className="failure-meta"><span>{result.error.retryable ? '可以稍后重试' : '修改查询条件后重试'}</span>{result.evidence ? <span>检查时间 {formatTime(result.evidence.asOf)}</span> : null}</div>
    </div>
  </section>;
}

function MarketView() {
  const [item, setItem] = useState('古纪V3');
  const [platform, setPlatform] = useState<MarketPlatform>('pc');
  const [crossplay, setCrossplay] = useState(true);
  const [rank, setRank] = useState('0');
  const [result, setResult] = useState<MarketQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedRank = parseRankInput(rank);
    if (!item.trim()) { setFormError('请输入物品名称。'); return; }
    if (parsedRank === null) { setFormError('等级必须是非负整数或 max。'); return; }
    setLoading(true); setFormError(null); setResult(null);
    try {
      setResult(await window.warframeCompanion.market.query({
        contractVersion: MARKET_QUERY_CONTRACT_VERSION, item: item.trim(), platform, crossplay, rank: parsedRank,
      }));
    } catch { setFormError('桌面进程未能完成查询。请检查系统健康后重试。'); }
    finally { setLoading(false); }
  };

  return <>
    <header className="hero market-hero"><div><p className="eyebrow">WARFRAME.MARKET / LIVE SNAPSHOT</p><h1>市场查询</h1><p className="hero__copy">查询公开挂单与 90 日已成交统计。结果只读，不会下单或发送私聊。</p></div><span className="readonly-chip">只读公开数据</span></header>
    <form className="market-form" onSubmit={(event) => void submit(event)}>
      <label className="field field--item"><span>物品名称</span><input value={item} onChange={(event) => setItem(event.target.value)} placeholder="例如：古纪V3、悟空P、赋能充沛" autoFocus /></label>
      <label className="field"><span>平台</span><select value={platform} onChange={(event) => setPlatform(event.target.value as MarketPlatform)}>{MARKET_PLATFORMS.map((value) => <option value={value} key={value}>{PLATFORM_LABELS[value]}</option>)}</select></label>
      <label className="field"><span>等级</span><input value={rank} onChange={(event) => setRank(event.target.value)} inputMode="numeric" aria-describedby="rank-help" /><small id="rank-help">输入 0、具体等级或 max</small></label>
      <label className="crossplay"><input type="checkbox" checked={crossplay} onChange={(event) => setCrossplay(event.target.checked)} /><span><i />跨平台交易<small>仅匹配同一交易范围</small></span></label>
      <button className="query-button" type="submit" disabled={loading}><span className={loading ? 'spin' : ''}>{loading ? '↻' : '⌕'}</span>{loading ? '正在查询' : '查询行情'}</button>
    </form>
    {formError ? <div className="error-banner" role="alert">{formError}</div> : null}
    {!result && !loading && !formError ? <section className="market-welcome"><div className="radar"><i /><i /><span>⌕</span></div><h2>输入物品，获取可验证行情</h2><p>平台、跨平台范围和等级均由你显式选择；空订单与数据源故障会分别显示。</p></section> : null}
    {loading ? <section className="market-loading"><div className="scan-line" /><p>正在解析物品并读取当前订单……</p><small>Warframe.Market 公共只读接口</small></section> : null}
    {result?.ok ? <MarketSuccessCard result={result} /> : result ? <MarketFailureCard result={result} onCandidate={(value) => { setItem(value); setResult(null); }} /> : null}
  </>;
}

interface ChatTurn { id: string; user: string; assistant: string; events: AgentStreamEvent[]; trace?: AgentTrace }

interface ModelConfigForm {
  id: string; label: string; model: string; baseUrl: string; credentialVariable: string;
  contextWindow: string; maxOutputTokens: string; nativeTools: boolean; structuredOutput: boolean;
  streaming: boolean; cancellation: boolean; vision: boolean; reasoning: boolean;
}
const DEFAULT_MODEL_CONFIG_FORM: ModelConfigForm = {
  id: 'local-openai-model', label: '本机 OpenAI-compatible', model: '', baseUrl: 'http://127.0.0.1:11434/v1', credentialVariable: '',
  contextWindow: '16384', maxOutputTokens: '2048', nativeTools: true, structuredOutput: true,
  streaming: true, cancellation: true, vision: false, reasoning: false,
};

function traceEventText(entry: AgentStreamEvent): string {
  if (entry.type === 'status') return entry.text;
  if (entry.type === 'model_selected') return `${entry.profile.label} · ${entry.profile.model}`;
  if (entry.type === 'tool_call') return `${entry.name} ${JSON.stringify(entry.arguments)}`;
  if (entry.type === 'tool_result') return `${entry.name} · ${entry.summary}`;
  if (entry.type === 'model_error') return `${entry.error.code} · ${entry.error.message}`;
  if (entry.type === 'model_conclusion') return `终态 ${entry.conclusion} · ${entry.source === 'model' ? '模型' : 'Harness'}`;
  return entry.type === 'message_delta' ? entry.delta : entry.message;
}

function AgentView() {
  const [message, setMessage] = useState('查一下古纪V3当前行情，PC 跨平台，0级。');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [running, setRunning] = useState(false);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [modelHealth, setModelHealth] = useState<ModelHealth | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configForm, setConfigForm] = useState<ModelConfigForm>(DEFAULT_MODEL_CONFIG_FORM);
  const [configMessage, setConfigMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const refreshModels = useCallback(async (preferredId?: string) => {
    const snapshot = await window.warframeCompanion.agent.listModels();
    setModels(snapshot.profiles);
    setProfileId((current) => preferredId || (snapshot.profiles.some((profile) => profile.id === current) ? current : snapshot.profiles[0]?.id || ''));
    if (snapshot.configError) setConfigMessage({ tone: 'bad', text: `${snapshot.configError.code}：${snapshot.configError.message}` });
  }, []);
  useEffect(() => {
    void refreshModels().catch(() => {
      setConfigMessage({ tone: 'bad', text: '无法读取本机模型配置。' });
    });
  }, [refreshModels]);
  useEffect(() => {
    if (!profileId) return;
    setModelHealth(null);
    void window.warframeCompanion.agent.checkModel(profileId).then(setModelHealth);
  }, [profileId]);
  const selectedProfile = models.find((profile) => profile.id === profileId);

  const saveModel = async (event: FormEvent) => {
    event.preventDefault(); setConfigMessage(null);
    const contextWindow = Number(configForm.contextWindow); const maxOutputTokens = Number(configForm.maxOutputTokens);
    const capabilities: ModelCapabilities = {
      text: true, vision: configForm.vision, nativeTools: configForm.nativeTools, structuredOutput: configForm.structuredOutput,
      reasoning: configForm.reasoning, streaming: configForm.streaming, cancellation: configForm.cancellation, contextWindow,
    };
    const input: OpenAICompatibleProfileInput = {
      id: configForm.id.trim(), label: configForm.label.trim(), model: configForm.model.trim(),
      description: '本机配置的 OpenAI-compatible Chat Completions 模型；只保存凭据引用。', capabilities,
      configuration: {
        configVersion: '1.0', baseUrl: configForm.baseUrl.trim(), api: 'chat_completions', healthCheck: 'models',
        credential: configForm.credentialVariable.trim() ? { kind: 'environment', variable: configForm.credentialVariable.trim() } : { kind: 'none' },
        maxOutputTokens,
      },
    };
    const result = await window.warframeCompanion.agent.saveModel(input);
    if (!result.ok) { setConfigMessage({ tone: 'bad', text: `${result.error.code}：${result.error.message}` }); return; }
    setConfigMessage({ tone: 'good', text: '配置已保存到本机；未保存或显示任何密钥值。' });
    await refreshModels(result.profile.id);
  };
  const deleteModel = async () => {
    if (!selectedProfile || selectedProfile.source !== 'local_config' || running) return;
    const result = await window.warframeCompanion.agent.deleteModel(selectedProfile.id);
    if (!result.ok) { setConfigMessage({ tone: 'bad', text: `${result.error.code}：${result.error.message}` }); return; }
    setConfigMessage({ tone: 'good', text: '本机 profile 已删除；环境变量与模型服务未被修改。' });
    await refreshModels();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = message.trim();
    if (!prompt || running) return;
    const id = `desktop-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setTurns((current) => [...current, { id, user: prompt, assistant: '', events: [] }]);
    setRunning(true); setActiveRequestId(id); setMessage('');
    let stop = () => {};
    stop = window.warframeCompanion.agent.run({ requestId: id, message: prompt, modelProfileId: profileId, timeoutMs: 15_000 }, (streamEvent) => {
      setTurns((current) => current.map((turn) => {
        if (turn.id !== id) return turn;
        if (streamEvent.type === 'message_delta') return { ...turn, assistant: turn.assistant + streamEvent.delta, events: [...turn.events, streamEvent] };
        if (streamEvent.type === 'completed') return { ...turn, assistant: streamEvent.message, trace: streamEvent.trace, events: [...turn.events, streamEvent] };
        return { ...turn, events: [...turn.events, streamEvent] };
      }));
      if (streamEvent.type === 'completed') { setRunning(false); setActiveRequestId(null); stop(); }
    });
  };

  const cancel = () => {
    if (activeRequestId) window.warframeCompanion.agent.cancel(activeRequestId);
  };

  return <div className="agent-view">
    <header className="hero market-hero"><div><p className="eyebrow">WARFRAME AGENT HARNESS / MODEL ROUTING</p><h1>Agent 对话</h1><p className="hero__copy">模型 profile、能力门禁、工具、证据、停止与轨迹由 Companion 自有 Harness 统一编排。</p></div><span className="readonly-chip">离线模型后端 · 只读</span></header>
    <section className="model-console">
      <label><span>主 Agent 模型</span><select value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={running}>{models.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
      <div className="model-summary"><strong>{selectedProfile?.model ?? '正在读取 profile'}</strong><small>{selectedProfile?.description}</small></div>
      <div className={`model-health model-health--${modelHealth?.status ?? 'checking'}`}><i />{modelHealth?.status === 'healthy' ? '可运行' : modelHealth?.status === 'incompatible' ? '能力不兼容' : modelHealth?.status === 'unavailable' ? '不可用' : '检查中'}</div>
      {selectedProfile ? <div className="capability-row">
        <span className={selectedProfile.capabilities.nativeTools ? 'capability--on' : ''}>工具</span>
        <span className={selectedProfile.capabilities.structuredOutput ? 'capability--on' : ''}>结构化输出</span>
        <span className={selectedProfile.capabilities.streaming ? 'capability--on' : ''}>原生流式</span>
        <span className={selectedProfile.capabilities.vision ? 'capability--on' : ''}>视觉</span>
        <span>{Math.round(selectedProfile.capabilities.contextWindow / 1024)}K 上下文</span>
      </div> : null}
      <div className="model-actions"><button type="button" onClick={() => setConfigOpen((value) => !value)} disabled={running}>{configOpen ? '收起配置' : '配置本机模型'}</button>{selectedProfile?.source === 'local_config' ? <button className="danger-link" type="button" onClick={() => void deleteModel()} disabled={running}>删除此配置</button> : null}</div>
      {modelHealth ? <p className={`compatibility-hint compatibility-hint--${modelHealth.status}`}>{modelHealth.error ? `${modelHealth.error.code} · ` : ''}{modelHealth.summary}{modelHealth.missingCapabilities.length ? ` 缺少：${modelHealth.missingCapabilities.join('、')}` : ''}</p> : null}
    </section>
    {configOpen ? <form className="model-config" onSubmit={(event) => void saveModel(event)}>
      <div className="model-config__heading"><div><p className="eyebrow">LOCAL PROFILE / KEYLESS CONTRACT</p><h2>OpenAI-compatible 配置</h2></div><p>只保存 Base URL、模型名、能力声明与环境变量名；不会把 key 写入配置。健康检查仅调用 <code>/models</code>，发送消息时才调用 <code>/chat/completions</code>。</p></div>
      <div className="model-config__grid">
        <label><span>Profile ID</span><input value={configForm.id} onChange={(event) => setConfigForm({ ...configForm, id: event.target.value })} pattern="[a-z0-9][a-z0-9-]{0,79}" required /></label>
        <label><span>显示名称</span><input value={configForm.label} onChange={(event) => setConfigForm({ ...configForm, label: event.target.value })} required /></label>
        <label><span>模型 ID</span><input value={configForm.model} onChange={(event) => setConfigForm({ ...configForm, model: event.target.value })} placeholder="服务端模型名" required /></label>
        <label className="model-config__wide"><span>Base URL</span><input value={configForm.baseUrl} onChange={(event) => setConfigForm({ ...configForm, baseUrl: event.target.value })} required /><small>HTTPS，或本机 localhost / 127.0.0.1 / ::1 的 HTTP。</small></label>
        <label><span>凭据环境变量名</span><input value={configForm.credentialVariable} onChange={(event) => setConfigForm({ ...configForm, credentialVariable: event.target.value.toUpperCase() })} placeholder="留空 = keyless" pattern="[A-Z_][A-Z0-9_]{0,127}" /><small>这里只填变量名，不填 key 值。</small></label>
        <label><span>上下文窗口</span><input type="number" min="1024" max="2000000" value={configForm.contextWindow} onChange={(event) => setConfigForm({ ...configForm, contextWindow: event.target.value })} required /></label>
        <label><span>最大输出 tokens</span><input type="number" min="64" max="32768" value={configForm.maxOutputTokens} onChange={(event) => setConfigForm({ ...configForm, maxOutputTokens: event.target.value })} required /></label>
      </div>
      <fieldset><legend>实际能力声明</legend>{([
        ['nativeTools', '结构化工具调用'], ['structuredOutput', '结构化输出'], ['streaming', 'SSE 流式输出'], ['cancellation', '请求取消'], ['vision', '视觉输入'], ['reasoning', '推理能力'],
      ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={configForm[key]} onChange={(event) => setConfigForm({ ...configForm, [key]: event.target.checked })} /><span>{label}</span></label>)}</fieldset>
      <div className="model-config__footer"><p>桌面 Agent 当前必须具备：文本、结构化工具、结构化输出、取消。未声明的能力会明确标为不兼容；视觉能力不会被推断。</p><button type="submit">保存本机配置</button></div>
      {configMessage ? <div className={`config-message config-message--${configMessage.tone}`}>{configMessage.text}</div> : null}
    </form> : configMessage ? <div className={`config-message config-message--${configMessage.tone}`}>{configMessage.text}</div> : null}
    <section className="agent-layout">
      <div className="conversation">
        {turns.length === 0 ? <div className="agent-welcome"><div className="radar"><i /><i /><span>◌</span></div><h2>从一句可验证请求开始</h2><p>市场例：查一下古纪V3当前行情，PC 跨平台，0级。掉落例：Forma Blueprint 哪里掉落？</p></div> : null}
        {turns.map((turn) => <article className="chat-turn" key={turn.id}>
          <div className="bubble bubble--user"><span>你</span><p>{turn.user}</p></div>
          <div className="bubble bubble--agent"><span>Agent</span><p>{turn.assistant || '正在处理…'}</p></div>
          <details className="trace-panel" open={turns.at(-1)?.id === turn.id}>
            <summary>执行轨迹 <small>{turn.trace ? `${turn.trace.decision} · ${turn.trace.latencyMs}ms` : '流式更新中'}</small></summary>
            <div className="trace-events">{turn.events.filter((entry) => entry.type !== 'message_delta' && entry.type !== 'completed').map((entry, index) => <div key={index}>
              <b>{entry.type}</b><code>{traceEventText(entry)}</code>
            </div>)}</div>
          </details>
        </article>)}
      </div>
      <form className="agent-composer" onSubmit={submit}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="输入公开只读查询…" rows={2} /><button type={running ? 'button' : 'submit'} className={running ? 'stop-button' : ''} disabled={!running && (!message.trim() || modelHealth?.status !== 'healthy')} onClick={running ? cancel : undefined}>{running ? '停止' : '发送'}</button><small>15 秒超时 · 可停止 · 不操作游戏、交易、聊天或账号资产；当前模型为本地离线规则后端，不产生模型费用。</small></form>
    </section>
  </div>;
}

export function App() {
  const [view, setView] = useState<View>('market');
  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand__sigil">W</span><span>WARFRAME<br />COMPANION</span></div>
      <nav aria-label="主导航">
        <button className={`nav-item ${view === 'health' ? 'nav-item--active' : ''}`} type="button" onClick={() => setView('health')}><span>⌁</span>系统概览</button>
        <button className={`nav-item ${view === 'market' ? 'nav-item--active' : ''}`} type="button" onClick={() => setView('market')}><span>◇</span>市场查询<small>原生行情卡</small></button>
        <button className={`nav-item ${view === 'agent' ? 'nav-item--active' : ''}`} type="button" onClick={() => setView('agent')}><span>◌</span>Agent 对话<small>流式工具轨迹</small></button>
      </nav>
      <div className="boundary-note"><span>只读模式</span>不操作游戏、交易、聊天或账号资产</div>
    </aside>
    <section className="content">{view === 'health' ? <HealthView /> : view === 'market' ? <MarketView /> : <AgentView />}<footer><span>Warframe Agent Harness · 模型可配置、公开数据只读</span><span>本地模型 profile → 能力门禁 → market.query / drops.search → 证据与轨迹。</span></footer></section>
  </main>;
}
