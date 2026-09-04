import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  MARKET_PLATFORMS,
  MARKET_QUERY_CONTRACT_VERSION,
  type MarketPlatform,
  type MarketQueryRequest,
  type MarketQueryResult,
} from '@warframe-companion/market-query-contract';
import type { ComponentHealth, HealthStatus, SystemHealthSnapshot } from '../system-health.js';
import type { AgentStreamEvent, AgentTrace, ModelCapabilities, ModelHealth, ModelProfile, OpenAICompatibleProfileInput } from '@warframe-companion/agent-runtime';
import {
  PLATFORM_LABELS,
  parseRankInput,
} from './market-presentation.js';

import { Icon, OrbitMark, BrandMark } from './Icon.js';
import { MarketResultCard } from './MarketResultCard.js';
import { useLayoutPreference } from './use-layout-preference.js';
import { formatTime } from './format-time.js';
import type { MarketPresentationEvent } from '../agent-presentation.js';

type View = 'overview' | 'agent';

function SettingsDialog({ open, onClose, children, title = '设置' }: { open: boolean; onClose: () => void; children: React.ReactNode; title?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else if (dialog.current?.open) {
      const element = dialog.current;
      const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100 });
      void animation.finished.then(() => element.close()).catch(() => {});
      return () => animation.cancel();
    }
  }, [open]);
  return <dialog ref={dialog} className="settings-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}>
    <header className="section-heading"><h2>{title}</h2><button type="button" onClick={onClose} autoFocus>关闭{title}</button></header>
    {children}
  </dialog>;
}

const STATUS_COPY: Record<HealthStatus, { label: string; tone: string }> = {
  healthy: { label: '正常', tone: 'good' },
  degraded: { label: '降级', tone: 'warn' },
  unavailable: { label: '不可用', tone: 'bad' },
  not_configured: { label: '未配置', tone: 'idle' },
};

function HealthCard({ component }: { component: ComponentHealth }) {
  const status = STATUS_COPY[component.status];
  return (
    <article className="health-card">
      <div className="health-card__topline">
        <Icon name="settings" />
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
      <div><h1>系统健康</h1><p className="hero__copy">一眼确认桌面端、本机集成与公共数据源是否处于可用状态。</p></div>
      <button className="refresh" type="button" onClick={() => void refresh()} disabled={loading}><span className={loading ? 'spin' : ''}><Icon name="refresh" /></span>{loading ? '检查中' : '重新检查'}</button>
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

function MarketView({ onResult }: { onResult: (market: MarketPresentationEvent, prompt: string) => void }) {
  const [item, setItem] = useState('古纪V3');
  const [platform, setPlatform] = useState<MarketPlatform>('pc');
  const [crossplay, setCrossplay] = useState(true);
  const [rank, setRank] = useState('0');
  const [result, setResult] = useState<MarketQueryResult | null>(null);
  const [resultRequest, setResultRequest] = useState<MarketQueryRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const query = async () => {
    const parsedRank = parseRankInput(rank);
    if (!item.trim()) { setFormError('请输入物品名称。'); return; }
    if (parsedRank === null) { setFormError('等级必须是非负整数或 max。'); return; }
    if (loading) return;
    setLoading(true); setFormError(null);
    const request: MarketQueryRequest = {
      contractVersion: MARKET_QUERY_CONTRACT_VERSION, item: item.trim(), platform, crossplay, rank: parsedRank,
    };
    try {
      const next = await window.warframeCompanion.market.query(request);
      setResultRequest(request); setResult(next);
      onResult({ type: 'market_result', request, result: next }, `查询${request.item}，${PLATFORM_LABELS[request.platform]}，${request.crossplay ? '跨平台' : '不跨平台'}，${request.rank === 'max' ? '满级' : `${request.rank}级`}。`);
    } catch { setFormError('桌面进程未能完成查询。请检查系统健康后重试。'); }
    finally { setLoading(false); }
  };

  return <>
    <header className="hero market-hero"><div><h1>市场查询</h1><p className="hero__copy">查询公开挂单与 90 日已成交统计。结果只读，不会下单或发送私聊。</p></div><span className="readonly-chip">只读公开数据</span></header>
    <form className="market-form" onSubmit={(event) => { event.preventDefault(); void query(); }}>
      <label className="field field--item"><span>物品名称</span><input value={item} onChange={(event) => setItem(event.target.value)} placeholder="例如：古纪V3、悟空P、赋能充沛" autoFocus /></label>
      <label className="field"><span>平台</span><select value={platform} onChange={(event) => setPlatform(event.target.value as MarketPlatform)}>{MARKET_PLATFORMS.map((value) => <option value={value} key={value}>{PLATFORM_LABELS[value]}</option>)}</select></label>
      <label className="field"><span>等级</span><input value={rank} onChange={(event) => setRank(event.target.value)} inputMode="numeric" aria-describedby="rank-help" /><small id="rank-help">输入 0、具体等级或 max</small></label>
      <label className="crossplay"><input type="checkbox" checked={crossplay} onChange={(event) => setCrossplay(event.target.checked)} /><span><i />跨平台交易<small>仅匹配同一交易范围</small></span></label>
      <button className="query-button" type="submit" disabled={loading}><span className={loading ? 'spin' : ''}><Icon name={loading ? "refresh" : "search"} /></span>{loading ? '正在查询' : '查询行情'}</button>
    </form>
    {formError ? <div className="error-banner" role="alert">{formError}</div> : null}
    {!result && !loading && !formError ? <section className="market-welcome"><div className="empty-symbol"><Icon name="market" /></div><h2>先看看它值多少</h2><p>输入中文名、英文名或常用简称，选择平台和等级后查询。</p></section> : null}
    {loading ? <section className="market-loading" role="status"><span className="spin"><Icon name="refresh" /></span><div><p>正在读取当前订单…</p><small>{result ? '下方暂时保留上次结果，完成后更新。' : '正在匹配物品并连接 Warframe.Market'}</small></div></section> : null}
    {result && resultRequest ? <MarketResultCard result={result} request={resultRequest} onCandidate={(value) => { setItem(value); setResult(null); }} onRetry={() => void query()} disabled={loading} /> : null}
  </>;
}

interface ChatTurn { id: string; user: string; assistant: string; events: AgentStreamEvent[]; markets: MarketPresentationEvent[]; trace?: AgentTrace }

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
  const [view, setView] = useState<View>('overview');
  const [assistantOpen, setAssistantOpen] = useLayoutPreference('companion.assistant-open', true);
  const [sidebarExpanded, setSidebarExpanded] = useLayoutPreference('companion.sidebar-expanded', false);
  const [marketPinned, setMarketPinned] = useLayoutPreference('companion.pin-market', false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [narrow, setNarrow] = useState(window.innerWidth < 1100);
  useEffect(() => { const resize = () => setNarrow(window.innerWidth < 1100); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const assistantVisible = assistantOpen && (view === 'agent' || !narrow);
  const toggleAssistant = () => {
    if (assistantVisible) { setAssistantOpen(false); setView('overview'); }
    else { setAssistantOpen(true); if (narrow) setView('agent'); }
  };
  const openMarket = () => { setMarketVisited(true); setMarketOpen(true); setDetail(null); setView('overview'); };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketVisited, setMarketVisited] = useState(false);
  const [detail, setDetail] = useState<{ market: MarketPresentationEvent; prompt: string } | null>(null);
  const [recent, setRecent] = useState<{ market: MarketPresentationEvent; prompt: string }[]>([]);
  const recordResult = (market: MarketPresentationEvent, prompt: string) => setRecent((current) => [{ market, prompt }, ...current]);
  const composer = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const showDetail = (market: MarketPresentationEvent, prompt: string) => {
    setDetail({ market, prompt }); setMarketOpen(false); setView('overview');
  };
  const draft = (value: string) => {
    setMessage(value); setView('agent'); setAssistantOpen(true);
    requestAnimationFrame(() => composer.current?.focus());
  };
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  useEffect(() => {
    if (followLatest.current && conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [turns, view, assistantOpen]);
  const [running, setRunning] = useState(false);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [modelHealth, setModelHealth] = useState<ModelHealth | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const activeRun = useRef<{ id: string; dispose: () => void } | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [configForm, setConfigForm] = useState<ModelConfigForm>(DEFAULT_MODEL_CONFIG_FORM);
  const [configMessage, setConfigMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  useEffect(() => () => {
    const run = activeRun.current;
    activeRun.current = null;
    if (run) {
      run.dispose();
      window.warframeCompanion.agent.cancel(run.id);
    }
  }, []);

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
    let current = true;
    setModelHealth(null);
    void window.warframeCompanion.agent.checkModel(profileId).then((health) => {
      if (current) setModelHealth(health);
    }).catch(() => {
      if (current) setConfigMessage({ tone: 'bad', text: '无法检查模型连接，请重新选择模型后重试。' });
    });
    return () => { current = false; };
  }, [profileId]);
  const selectedProfile = models.find((profile) => profile.id === profileId);

  const saveModel = async (event: FormEvent) => {
    event.preventDefault(); if (configBusy) return; setConfigMessage(null); setConfigBusy(true);
    try {
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
    setConfigMessage({ tone: 'good', text: '模型配置已保存，正在检查连接。' });
    await refreshModels(result.profile.id);
    } catch { setConfigMessage({ tone: 'bad', text: '保存失败，请检查本机连接后重试。输入的配置已保留。' }); }
    finally { setConfigBusy(false); }
  };
  const deleteModel = async () => {
    if (!selectedProfile || selectedProfile.source !== 'local_config' || running || configBusy) return;
    setConfigBusy(true);
    try {
    const result = await window.warframeCompanion.agent.deleteModel(selectedProfile.id);
    if (!result.ok) { setConfigMessage({ tone: 'bad', text: `${result.error.code}：${result.error.message}` }); return; }
    setConfigMessage({ tone: 'good', text: '已删除本机模型配置。' });
    await refreshModels();
    } catch { setConfigMessage({ tone: 'bad', text: '未能删除配置，请重试。' }); }
    finally { setConfigBusy(false); }
  };

  const runPrompt = (prompt: string) => {
    if (!prompt.trim() || activeRun.current || modelHealth?.status !== 'healthy') return;
    const id = `desktop-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    followLatest.current = true;
    setTurns((current) => [...current, { id, user: prompt, assistant: '', events: [], markets: [] }]);
    setRunning(true); setActiveRequestId(id); setMessage('');
    activeRun.current = { id, dispose: () => {} };
    try {
      const dispose = window.warframeCompanion.agent.run({ requestId: id, message: prompt, modelProfileId: profileId, timeoutMs: 15_000 }, (streamEvent) => {
        if (activeRun.current?.id !== id) return;
        if (streamEvent.type === 'market_result') recordResult(streamEvent, prompt);
        setTurns((current) => current.map((turn) => {
          if (turn.id !== id) return turn;
          if (streamEvent.type === 'market_result') return { ...turn, markets: [...turn.markets, streamEvent] };
          if (streamEvent.type === 'message_delta') return { ...turn, assistant: turn.assistant + streamEvent.delta, events: [...turn.events, streamEvent] };
          if (streamEvent.type === 'completed') return { ...turn, assistant: streamEvent.message, trace: streamEvent.trace, events: [...turn.events, streamEvent] };
          return { ...turn, events: [...turn.events, streamEvent] };
        }));
        if (streamEvent.type === 'completed') {
          activeRun.current.dispose(); activeRun.current = null;
          setRunning(false); setActiveRequestId(null);
        }
      });
      if (activeRun.current?.id === id) activeRun.current.dispose = dispose;
      else dispose();
    } catch {
      activeRun.current?.dispose(); activeRun.current = null;
      setRunning(false); setActiveRequestId(null); setMessage(prompt);
      setTurns((current) => current.map((turn) => turn.id === id
        ? { ...turn, assistant: '无法启动查询，请重新发送。' } : turn));
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); runPrompt(message.trim()); };

  const cancel = () => {
    if (activeRequestId) window.warframeCompanion.agent.cancel(activeRequestId);
  };

  return <main className={`shell companion-shell ${sidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
    <aside className="sidebar">
      <button className="sidebar-toggle" aria-label={sidebarExpanded ? '收起导航' : '展开导航'} title={sidebarExpanded ? '收起导航' : '展开导航'} aria-expanded={sidebarExpanded} onClick={() => setSidebarExpanded(!sidebarExpanded)}><Icon name={sidebarExpanded ? "left" : "right"} /></button>
      <nav aria-label="主导航">
        <button title="总览" aria-label="总览" className={`nav-item ${!marketOpen && !detail ? 'nav-item--active' : ''}`} onClick={() => { setView('overview'); setDetail(null); setMarketOpen(false); }}><Icon name="home" active={!marketOpen && !detail} /><b className="nav-label">总览</b></button>
        {marketPinned ? <button title="市场" aria-label="市场" className={`nav-item ${marketOpen ? 'nav-item--active' : ''}`} onClick={openMarket}><Icon name="market" active={marketOpen} /><b className="nav-label">市场</b></button> : null}
      </nav>
      <button className="nav-item add-feature" title="添加功能" aria-label="添加功能" onClick={() => setFeaturesOpen(true)}><Icon name="plus" /><b className="nav-label">添加功能</b></button>
      <button className="settings-entry" title="设置" aria-label="设置" onClick={() => setSettingsOpen(true)}><Icon name="settings" /><b className="nav-label">设置</b></button>
    </aside>
    <div className="application-main">
      <header className="app-toolbar"><span className="app-wordmark"><BrandMark /><b>Warframe Companion</b><small>个人工作台</small></span><button aria-label="助手" aria-expanded={assistantVisible} onClick={toggleAssistant}><Icon name="assistant" active={assistantVisible} />助手 {assistantVisible ? '收起' : '展开'}</button></header>
    <div className={`companion-body ${view === 'agent' ? 'companion-body--focused' : ''} ${!assistantOpen ? 'companion-body--closed' : ''}`}>
      <section className="workspace" aria-label="总览与结果" hidden={view === 'agent'}>
        <header className="workspace-bar"><span>{detail ? '行情详情' : marketOpen ? '市场' : '总览'}</span></header>
        <div className="workspace-scroll">
          <div hidden={!!detail || marketOpen}>
            <header className="overview-heading"><div><h1>今天想找些什么？</h1><p>从一件装备开始，找到值得投入的方向。</p></div><OrbitMark /></header>
            <div className="quick-actions">
              <button onClick={openMarket}><span className="action-icon"><Icon name="market" /></span><div><strong>查市场价格</strong><small>公开挂单与成交行情</small></div><Icon name="arrow" /></button>
              <button onClick={() => draft('Forma Blueprint 哪里掉落？')}><span className="action-icon"><Icon name="drops" /></span><div><strong>找掉落地点</strong><small>任务、地点与掉落概率</small></div><Icon name="arrow" /></button>
            </div>
            <section className="recent-results"><h2>最近查看 <span>本次会话</span></h2>{recent.length ? <div className="recent-list">{recent.map(({ market, prompt }, index) => <button key={index} onClick={() => showDetail(market, prompt)}><strong>{market.result.ok ? market.result.data.item.name.zhHans : market.request.item}</strong><small>{PLATFORM_LABELS[market.request.platform]} · {market.result.ok ? formatTime(market.result.evidence.asOf) : '查询未完成'} →</small></button>)}</div> : <div className="recent-empty"><Icon name="history" /><h3>还没有查询记录</h3><p>从上方选择一个查询，结果会留在这里。</p><button onClick={openMarket}>查询第一件物品 <Icon name="arrow" /></button></div>}</section>
            <p className="overview-note">活动推荐与个人进度尚未接入。</p>
          </div>
          {marketVisited ? <div hidden={!marketOpen}><button className="back-link" onClick={() => setMarketOpen(false)}><Icon name="left" /> 返回总览</button><MarketView onResult={recordResult} /></div> : null}
          {detail ? <div><button className="back-link" onClick={() => setDetail(null)}><Icon name="left" /> 返回总览</button><MarketResultCard result={detail.market.result} request={detail.market.request} onCandidate={(value) => draft(`查询${value}，${PLATFORM_LABELS[detail.market.request.platform]}，${detail.market.request.crossplay ? '跨平台' : '不跨平台'}，${detail.market.request.rank === 'max' ? '满级' : `${detail.market.request.rank}级`}。`)} disabled={running || modelHealth?.status !== 'healthy'} onRetry={() => { runPrompt(detail.prompt); setView('agent'); setAssistantOpen(true); }} /></div> : null}
        </div>
      </section>
      <div className="agent-view" hidden={view !== 'agent' && !assistantOpen}>
        <header className="assistant-bar"><div><h2>助手</h2><span>{running ? '正在查询…' : selectedProfile?.label ?? '正在连接'}</span></div><button onClick={() => { if (view === 'agent') setView('overview'); else setView('agent'); }}>{view === 'agent' ? '还原布局' : '放大对话'}</button></header>
        {modelHealth && modelHealth.status !== 'healthy' ? <button className="connection-notice" onClick={() => setSettingsOpen(true)}>{modelHealth.summary} · 打开设置</button> : null}
        {configMessage?.tone === 'bad' ? <button className="connection-notice" onClick={() => setSettingsOpen(true)}>{configMessage.text} · 打开设置</button> : null}
  <section className="agent-layout">
      <div className="conversation" ref={conversation} onScroll={(event) => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
        {turns.length === 0 ? <div className="agent-welcome"><div className="assistant-emblem"><Icon name="assistant" /></div><h2>一起找到答案。</h2><p>查行情、找掉落，<br />或说说你正在准备什么。</p><div className="prompt-chips"><button onClick={() => draft('查一下古纪V3当前行情，PC 跨平台，0级。')}><Icon name="market" />古纪 V3 多少钱？<Icon name="arrow" /></button><button onClick={() => draft('Forma Blueprint 哪里掉落？')}><Icon name="drops" />Forma 蓝图哪里刷？<Icon name="arrow" /></button></div></div> : null}
        {turns.map((turn) => <article className="chat-turn" key={turn.id}>
          <div className="bubble bubble--user"><span>你</span><p>{turn.user}</p></div>
          <div className="bubble bubble--agent"><span>Agent</span><p>{turn.assistant || '正在处理…'}</p></div>
          {turn.markets.map((market, index) => <MarketResultCard key={index} result={market.result} request={market.request} compact onOpen={() => showDetail(market, turn.user)}
            onRetry={() => runPrompt(turn.user)} disabled={running || modelHealth?.status !== 'healthy'}
            onCandidate={(value) => setMessage(`查询${value}，${PLATFORM_LABELS[market.request.platform]}，${market.request.crossplay ? '跨平台' : '不跨平台'}，${market.request.rank === 'max' ? '满级' : `${market.request.rank}级`}。`)} />)}
          <details className="trace-panel">
            <summary>执行轨迹 <small>{turn.trace ? `${turn.trace.decision} · ${turn.trace.latencyMs}ms` : '流式更新中'}</small></summary>
            <div className="trace-events">{turn.events.filter((entry) => entry.type !== 'message_delta' && entry.type !== 'completed').map((entry, index) => <div key={index}>
              <b>{entry.type}</b><code>{traceEventText(entry)}</code>
            </div>)}</div>
          </details>
        </article>)}
      </div>
      <form className="agent-composer" onSubmit={submit}><textarea ref={composer} aria-label="发送给助手" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="问问价格、掉落地点…" rows={2} /><button type={running ? 'button' : 'submit'} className={running ? 'stop-button' : ''} disabled={!running && (!message.trim() || modelHealth?.status !== 'healthy')} onClick={running ? cancel : undefined}>{running ? '停止' : '发送'}</button><small>{selectedProfile?.adapterId === 'warframe-local-rules' ? '本地规则 · 无模型费用' : '使用所选模型服务'} · 查询结果可展开查看</small></form>
    </section>
      </div>
    <SettingsDialog open={featuresOpen} onClose={() => setFeaturesOpen(false)} title="常用功能">
      <p>把常用功能固定到左侧，随时一键打开。</p>
      <div className="feature-choice"><div><strong><Icon name="market" /> 市场</strong><p>查询价格、查看买卖订单</p></div><button onClick={() => setMarketPinned(!marketPinned)} aria-pressed={marketPinned}>{marketPinned ? '取消固定市场' : '固定市场'}</button><button onClick={() => { openMarket(); setFeaturesOpen(false); }}>打开市场</button></div>
      <p className="overview-note">遗物、周常等功能完成后，会加入这里。掉落查询目前可通过助手使用。</p>
    </SettingsDialog>
    <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}>
    <section className="model-console">
      <label><span>助手使用的模型</span><select value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={running || configBusy}>{models.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
      <div className="model-summary"><strong>{selectedProfile?.model ?? '正在读取 profile'}</strong><small>{selectedProfile?.description}</small></div>
      <div className={`model-health model-health--${modelHealth?.status ?? 'checking'}`}><i />{modelHealth?.status === 'healthy' ? '可运行' : modelHealth?.status === 'incompatible' ? '能力不兼容' : modelHealth?.status === 'unavailable' ? '不可用' : '检查中'}</div>
      {selectedProfile ? <div className="capability-row">
        <span className={selectedProfile.capabilities.nativeTools ? 'capability--on' : ''}>工具</span>
        <span className={selectedProfile.capabilities.structuredOutput ? 'capability--on' : ''}>结构化输出</span>
        <span className={selectedProfile.capabilities.streaming ? 'capability--on' : ''}>原生流式</span>
        <span className={selectedProfile.capabilities.vision ? 'capability--on' : ''}>视觉</span>
        <span>{Math.round(selectedProfile.capabilities.contextWindow / 1024)}K 上下文</span>
      </div> : null}
      <div className="model-actions"><button type="button" onClick={() => setConfigOpen((value) => !value)} disabled={running || configBusy}>{configOpen ? '收起配置' : '配置本机模型'}</button>{selectedProfile?.source === 'local_config' ? <button className="danger-link" type="button" onClick={() => void deleteModel()} disabled={running || configBusy}>删除此配置</button> : null}</div>
      {modelHealth ? <p className={`compatibility-hint compatibility-hint--${modelHealth.status}`}>{modelHealth.error ? `${modelHealth.error.code} · ` : ''}{modelHealth.summary}{modelHealth.missingCapabilities.length ? ` 缺少：${modelHealth.missingCapabilities.join('、')}` : ''}</p> : null}
    </section>
    {configOpen ? <form className="model-config" onSubmit={(event) => void saveModel(event)}>
      <div className="model-config__heading"><div><h2>OpenAI-compatible 配置</h2></div><p>连接兼容 OpenAI 的模型服务。填写服务地址与模型名称，再按服务实际支持情况选择能力。</p></div>
      <fieldset className="model-config__grid" disabled={configBusy}>
        <label><span>Profile ID</span><input value={configForm.id} onChange={(event) => setConfigForm({ ...configForm, id: event.target.value })} pattern="[a-z0-9][a-z0-9-]{0,79}" required /></label>
        <label><span>显示名称</span><input value={configForm.label} onChange={(event) => setConfigForm({ ...configForm, label: event.target.value })} required /></label>
        <label><span>模型 ID</span><input value={configForm.model} onChange={(event) => setConfigForm({ ...configForm, model: event.target.value })} placeholder="服务端模型名" required /></label>
        <label className="model-config__wide"><span>Base URL</span><input value={configForm.baseUrl} onChange={(event) => setConfigForm({ ...configForm, baseUrl: event.target.value })} required /><small>HTTPS，或本机 localhost / 127.0.0.1 / ::1 的 HTTP。</small></label>
        <label><span>凭据环境变量名</span><input value={configForm.credentialVariable} onChange={(event) => setConfigForm({ ...configForm, credentialVariable: event.target.value.toUpperCase() })} placeholder="留空 = keyless" pattern="[A-Z_][A-Z0-9_]{0,127}" /><small>这里只填变量名，不填 key 值。</small></label>
        <label><span>上下文窗口</span><input type="number" min="1024" max="2000000" value={configForm.contextWindow} onChange={(event) => setConfigForm({ ...configForm, contextWindow: event.target.value })} required /></label>
        <label><span>最大输出 tokens</span><input type="number" min="64" max="32768" value={configForm.maxOutputTokens} onChange={(event) => setConfigForm({ ...configForm, maxOutputTokens: event.target.value })} required /></label>
      </fieldset>
      <fieldset disabled={configBusy}><legend>实际能力声明</legend>{([
        ['nativeTools', '结构化工具调用'], ['structuredOutput', '结构化输出'], ['streaming', 'SSE 流式输出'], ['cancellation', '请求取消'], ['vision', '视觉输入'], ['reasoning', '推理能力'],
      ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={configForm[key]} onChange={(event) => setConfigForm({ ...configForm, [key]: event.target.checked })} /><span>{label}</span></label>)}</fieldset>
      <div className="model-config__footer"><p>桌面 Agent 当前必须具备：文本、结构化工具、结构化输出、取消。未声明的能力会明确标为不兼容；视觉能力不会被推断。</p><button type="submit" disabled={configBusy}>{configBusy ? '正在保存…' : '保存本机配置'}</button></div>
      {configMessage ? <div role={configMessage.tone === 'bad' ? 'alert' : 'status'} className={`config-message config-message--${configMessage.tone}`}>{configMessage.text}</div> : null}
    </form> : configMessage ? <div role={configMessage.tone === 'bad' ? 'alert' : 'status'} className={`config-message config-message--${configMessage.tone}`}>{configMessage.text}</div> : null}
      <details className="health-settings" onToggle={(event) => setHealthOpen(event.currentTarget.open)}><summary>连接与诊断</summary>{healthOpen ? <HealthView /> : null}</details>
    </SettingsDialog>

    </div>
    </div>
  </main>;
}

export function App() { return <AgentView />; }
