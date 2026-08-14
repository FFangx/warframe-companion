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
import {
  ERROR_CATEGORY_LABELS,
  PLATFORM_LABELS,
  STATUS_LABELS,
  formatPlatinum,
  parseRankInput,
} from './market-presentation.js';

type View = 'health' | 'market';

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

export function App() {
  const [view, setView] = useState<View>('market');
  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand__sigil">W</span><span>WARFRAME<br />COMPANION</span></div>
      <nav aria-label="主导航">
        <button className={`nav-item ${view === 'health' ? 'nav-item--active' : ''}`} type="button" onClick={() => setView('health')}><span>⌁</span>系统概览</button>
        <button className={`nav-item ${view === 'market' ? 'nav-item--active' : ''}`} type="button" onClick={() => setView('market')}><span>◇</span>市场查询<small>原生行情卡</small></button>
        <button className="nav-item" type="button" disabled><span>◌</span>Agent 对话<small>规划中</small></button>
      </nav>
      <div className="boundary-note"><span>只读模式</span>不操作游戏、交易、聊天或账号资产</div>
    </aside>
    <section className="content">{view === 'health' ? <HealthView /> : <MarketView />}<footer><span>Session 5 · 桌面原生市场卡</span><span>当前挂单与历史成交明确分离。</span></footer></section>
  </main>;
}
