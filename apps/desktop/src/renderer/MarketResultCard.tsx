import type { MarketOrder, MarketQueryFailure, MarketQueryRequest, MarketQueryResult, MarketQuerySuccess } from '@warframe-companion/market-query-contract';
import { ERROR_CATEGORY_LABELS, PLATFORM_LABELS, STATUS_LABELS, formatPlatinum } from './market-presentation.js';
import { formatTime } from './format-time.js';

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

export function MarketResultCard({ result, request, onCandidate, onRetry, disabled = false }: {
  result: MarketQueryResult;
  request: MarketQueryRequest;
  onCandidate: (value: string) => void;
  onRetry: () => void;
  disabled?: boolean;
}) {
  return <div className="market-result-card">
    <p className="market-scope">{PLATFORM_LABELS[request.platform]} · {request.crossplay ? '跨平台' : '不跨平台'} · {request.rank === 'max' ? '满级' : `等级 ${request.rank}`}</p>
    {result.ok ? <MarketSuccessCard result={result} /> : <>
      <MarketFailureCard result={result} onCandidate={onCandidate} />
      <button type="button" className="market-retry" onClick={onRetry} disabled={disabled}>重新查询</button>
    </>}
  </div>;
}
