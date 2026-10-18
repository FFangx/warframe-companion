import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MarketQueryFailure,
  MarketQueryRequest,
  MarketQueryResult,
  MarketQuerySuccess,
  MarketUserStatus,
} from '@warframe-companion/market-query-contract';
import type { OrderPreview } from '../market-order-actions.js';
import {
  ERROR_CATEGORY_LABELS,
  PLATFORM_LABELS,
  STATUS_LABELS,
  formatPlatinum,
} from './market-presentation.js';
import {
  collectOrders,
  filterOrders,
  pageFor,
  type OrderRow,
  type OrderSideFilter,
  type OrderStatusFilter,
} from './market-order-list.js';
import { Icon } from './Icon.js';
import { formatTime } from './format-time.js';

type PreviewState =
  | { phase: 'none' }
  | { phase: 'loading' }
  | { phase: 'ready'; preview: OrderPreview }
  | { phase: 'copying'; preview: OrderPreview }
  | { phase: 'copied'; preview: OrderPreview }
  | { phase: 'error'; message: string };

function OrderPreviewBlock({ preview, onCopy, onClose, disabled }: {
  preview: PreviewState;
  onCopy: () => void;
  onClose: () => void;
  disabled: boolean;
}) {
  if (preview.phase === 'none') return null;
  if (preview.phase === 'loading') {
    return <div className="order-preview order-preview--busy" role="status">正在准备私聊文本…</div>;
  }
  if (preview.phase === 'error') {
    return <div className="order-preview" role="alert">
      <div className="preview-message">{preview.message}</div>
      <div className="preview-actions"><button type="button" className="order-action__button" onClick={onClose}>关闭</button></div>
    </div>;
  }
  const { preview: data } = preview;
  return <div className="order-preview" data-testid="order-preview">
    <div className="preview-meta">
      <span><b>物品</b>{data.itemName}</span>
      <span><b>等级</b>{data.itemRank} 级</span>
      <span><b>卖家</b>{data.seller} · {STATUS_LABELS[data.sellerStatus]}</span>
      <span><b>单价</b>{formatPlatinum(data.platinum)}</span>
      <span><b>购买数量</b>{data.purchaseQuantity}（库存 {data.inventory}）</span>
    </div>
    <p className="preview-text" data-testid="purchase-text">{data.text}</p>
    <div className="preview-actions">
      <button type="button" className="order-copy" data-testid="copy-order" onClick={onCopy} disabled={disabled || preview.phase === 'copying'}>
        {preview.phase === 'copying' ? '复制中…' : '复制文本'}
      </button>
      <button type="button" className="order-action__button" onClick={onClose}>收起</button>
      {preview.phase === 'copied' ? <span className="preview-feedback preview-feedback--good" role="status">已复制到剪贴板</span> : null}
    </div>
  </div>;
}

function OrdersPanel({ result, snapshotId, disabled, expired, onExpired }: {
  result: MarketQuerySuccess;
  snapshotId: string | null;
  disabled: boolean;
  expired: boolean;
  onExpired: () => void;
}) {
  const rows = useMemo(() => collectOrders(result), [result]);
  const [side, setSide] = useState<OrderSideFilter>('all');
  const [status, setStatus] = useState<OrderStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<{ key: string; orderIndex: number } | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ phase: 'none' });
  const requestSeq = useRef(0);

  const filtered = useMemo(() => filterOrders(rows, side, status), [rows, side, status]);
  const paged = useMemo(() => pageFor(filtered, page), [filtered, page]);

  const resetSelection = useCallback(() => {
    requestSeq.current += 1;
    setSelection(null);
    setPreview({ phase: 'none' });
  }, []);
  const resetPage = useCallback(() => setPage(1), []);

  // A new snapshot (refresh or replacement) clears the old selection and
  // pagination position; late preview/copy responses are dropped via requestSeq.
  useEffect(() => {
    resetSelection();
    resetPage();
  }, [snapshotId, resetSelection, resetPage]);

  const changeSide = (value: OrderSideFilter) => { setSide(value); resetSelection(); resetPage(); };
  const changeStatus = (value: OrderStatusFilter) => { setStatus(value); resetSelection(); resetPage(); };
  const clearFilters = () => { setSide('all'); setStatus('all'); resetSelection(); resetPage(); };

  const requestPreview = (row: OrderRow) => {
    if (!snapshotId || disabled || expired) return;
    const seq = ++requestSeq.current;
    setSelection({ key: `${row.side}-${row.sourceIndex}`, orderIndex: row.sourceIndex });
    setPreview({ phase: 'loading' });
    void window.warframeCompanion.market.previewOrder({ snapshotId, side: 'sell', orderIndex: row.sourceIndex }).then((response) => {
      if (requestSeq.current !== seq) return;
      if (response.ok) setPreview({ phase: 'ready', preview: response.preview });
      else {
        setPreview({ phase: 'error', message: response.error.message });
        if (response.error.code === 'EXPIRED') onExpired();
      }
    }).catch(() => {
      if (requestSeq.current !== seq) return;
      setPreview({ phase: 'error', message: '无法生成私聊预览，请稍后重试。' });
    });
  };

  const copyPreview = () => {
    if (!selection || !snapshotId || (preview.phase !== 'ready' && preview.phase !== 'copied') || disabled || expired) return;
    const seq = ++requestSeq.current;
    const data = preview.preview;
    setPreview({ phase: 'copying', preview: data });
    void window.warframeCompanion.market.copyOrder({ snapshotId, side: 'sell', orderIndex: selection.orderIndex }).then((response) => {
      if (requestSeq.current !== seq) return;
      if (response.ok) setPreview({ phase: 'copied', preview: data });
      else {
        setPreview({ phase: 'error', message: response.error.message });
        if (response.error.code === 'EXPIRED') onExpired();
      }
    }).catch(() => {
      if (requestSeq.current !== seq) return;
      setPreview({ phase: 'error', message: '写入剪贴板失败，请稍后重试。' });
    });
  };

  const snapshotEmpty = rows.length === 0;
  const filteredEmpty = !snapshotEmpty && filtered.length === 0;

  return <section className="orders-panel" aria-label="订单">
    <div className="orders-toolbar">
      <div className="orders-filters">
        <label><span>方向</span>
          <select value={side} onChange={(event) => changeSide(event.target.value as OrderSideFilter)} aria-label="按买卖方向筛选">
            <option value="all">全部</option>
            <option value="sell">卖单</option>
            <option value="buy">买单</option>
          </select>
        </label>
        <label><span>在线状态</span>
          <select value={status} onChange={(event) => changeStatus(event.target.value as OrderStatusFilter)} aria-label="按在线状态筛选">
            <option value="all">全部状态</option>
            {(Object.keys(STATUS_LABELS) as MarketUserStatus[]).map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
          </select>
        </label>
      </div>
      <div className="orders-count" aria-live="polite"><b>快照 {rows.length} 条</b><span>筛选后 {filtered.length} 条</span><span>第 {paged.page} / {paged.totalPages} 页</span></div>
    </div>
    {snapshotEmpty ? <div className="empty-orders">本次快照确认没有可见订单。</div>
      : filteredEmpty ? <div className="empty-orders empty-orders--filtered">
          <span>当前筛选条件下没有匹配的订单。</span>
          <button type="button" onClick={clearFilters}>清除筛选</button>
        </div>
      : <>
          <div className="order-list">
            {paged.rows.map((row, index) => {
              const key = `${row.side}-${row.sourceIndex}`;
              const selected = selection?.key === key && preview.phase !== 'none';
              return <div className="order-entry" key={key}>
                <div className="order-row">
                  <div className="order-rank">{paged.from + index + 1}</div>
                  <div className="order-user"><strong title={row.order.ingameName}>{row.order.ingameName}</strong><small><i className={`presence presence--${row.order.status}`} />{STATUS_LABELS[row.order.status]} · {PLATFORM_LABELS[row.order.platform]}</small></div>
                  <div className="order-quantity">库存 {row.order.quantity}</div>
                  <div className="order-price">{formatPlatinum(row.order.platinum)}</div>
                  <div className="order-action">{row.side === 'sell'
                    ? <button type="button" className="order-action__button" aria-label={`预览 ${row.order.ingameName} 的购买私聊文本`} disabled={!snapshotId || disabled || expired} onClick={() => (selected ? resetSelection() : requestPreview(row))}>{selected ? '收起' : '预览'}</button>
                    : null}</div>
                </div>
                {selected ? <OrderPreviewBlock preview={preview} onCopy={copyPreview} onClose={resetSelection} disabled={disabled || expired} /> : null}
              </div>;
            })}
          </div>
          <div className="orders-pagination">
            <span>显示第 {paged.from + 1}–{paged.to} 条</span>
            <div className="orders-pagination__controls">
              <button type="button" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)} aria-label="上一页">‹ 上一页</button>
              <span>第 {paged.page} / {paged.totalPages} 页</span>
              <button type="button" disabled={paged.page >= paged.totalPages} onClick={() => setPage(paged.page + 1)} aria-label="下一页">下一页 ›</button>
            </div>
          </div>
        </>}
  </section>;
}

function MarketSuccessCard({ result, snapshotId, onRefresh, disabled }: {
  result: MarketQuerySuccess;
  snapshotId: string | null;
  onRefresh: (() => void | Promise<void>) | undefined;
  disabled: boolean;
}) {
  const { item, sellOrders, buyOrders, statistics } = result.data;
  const [now, setNow] = useState(() => Date.now());
  const [forcedExpired, setForcedExpired] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const expiresAt = Date.parse(result.evidence.expiresAt);
  const expiresLabel = Number.isFinite(expiresAt) ? formatTime(result.evidence.expiresAt) : '未知时间';

  useEffect(() => {
    setForcedExpired(false);
    setRefreshFailed(false);
  }, [snapshotId]);

  useEffect(() => {
    if (forcedExpired) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [forcedExpired]);

  // Invalid expiry times and non-fresh evidence are treated the same as
  // expired: the main process refuses preview/copy and the card shows the
  // same explicit refresh entry instead of silently accepting the snapshot.
  const expired = !Number.isFinite(expiresAt) || result.evidence.freshness !== 'fresh' || expiresAt <= now || forcedExpired;

  const refresh = async () => {
    if (refreshing || !onRefresh) return;
    setRefreshing(true); setRefreshFailed(false);
    try { await onRefresh(); } catch { setRefreshFailed(true); } finally { setRefreshing(false); }
  };

  return <section className="market-result" aria-live="polite">
    <div className="result-heading">
      <div><h2>{item.name.zhHans}</h2><p>{item.name.en} · 等级 {item.rank.resolved}/{item.rank.maxRank}</p></div>
      <span className={`finding finding--${result.evidence.finding === 'confirmed_present' ? 'good' : 'empty'}`}>{result.evidence.finding === 'confirmed_present' ? '行情已确认' : '范围内无订单'}</span>
    </div>
    <div className="current-prices" aria-label="当前最优挂单"><div><span>最低卖价</span><strong>{sellOrders[0] ? formatPlatinum(sellOrders[0].platinum) : '暂无卖单'}</strong></div><div><span>最高买价</span><strong>{buyOrders[0] ? formatPlatinum(buyOrders[0].platinum) : '暂无买单'}</strong></div></div>
    <div className="market-metrics">
      <div><span>90 日成交中位数</span><strong>{statistics ? formatPlatinum(statistics.median) : '不可用'}</strong><small>{statistics ? `${statistics.sampleSize} 笔样本` : '不影响当前挂单快照'}</small></div>
      <div><span>日均成交量</span><strong>{statistics ? statistics.dailyVolume.toLocaleString('zh-CN') : '—'}</strong><small>仅统计已成交订单</small></div>
      <div><span>交易税</span><strong>{item.tradingTax == null ? '未知' : item.tradingTax.toLocaleString('zh-CN')}</strong><small>{item.ducats == null ? '无杜卡德信息' : `${item.ducats} 杜卡德`}</small></div>
    </div>
    {result.warnings.length ? <div className="warning-strip">{result.warnings.map((warning) => <span key={warning.code}>{warning.message}</span>)}</div> : null}
    {expired ? <div className="expired-banner" role="alert">
      <span>行情快照已过期或不再新鲜（有效至 {expiresLabel}）。刷新后需要重新选择订单，复制不会被自动执行。</span>
      <button type="button" onClick={() => void refresh()} disabled={refreshing || disabled}>{refreshing ? '正在刷新…' : '刷新订单'}</button>
    </div> : null}
    {refreshFailed ? <div className="preview-feedback preview-feedback--bad" role="alert">刷新失败，请重试。</div> : null}
    <OrdersPanel result={result} snapshotId={snapshotId} disabled={disabled || refreshing} expired={expired} onExpired={() => setForcedExpired(true)} />
    <div className="evidence-bar">
      <span><b>来源</b> Warframe.Market 公共接口</span><span><b>快照时间</b> {formatTime(result.evidence.asOf)}</span><span><b>有效至</b> {expiresLabel}</span><span><b>范围</b> 当前挂单 · 直接快照</span>
    </div>
  </section>;
}

function MarketFailureCard({ result, onCandidate, onRetry, disabled }: { result: MarketQueryFailure; onCandidate: (value: string) => void; onRetry: () => void; disabled: boolean }) {
  return <section className="market-failure" role="alert">
    <div className="failure-icon"><Icon name="search" /></div>
    <div><h2>{ERROR_CATEGORY_LABELS[result.error.category]}</h2><p>{result.error.message}</p>
      {result.error.details?.candidates?.length ? <div className="candidate-list"><span>请选择更准确的物品：</span>{result.error.details.candidates.map((candidate) => <button type="button" key={candidate.slug} onClick={() => onCandidate(candidate.name.zhHans)}>{candidate.name.zhHans}<small>{candidate.name.en}</small></button>)}</div> : null}
      <div className="failure-meta"><span>{result.error.retryable ? '可以稍后重试' : '修改查询条件后重试'}</span>{result.evidence ? <span>检查时间 {formatTime(result.evidence.asOf)}</span> : null}</div>
    </div>
    <button type="button" className="market-retry" onClick={onRetry} disabled={disabled}>重新查询</button>
  </section>;
}

export function MarketResultCard({ result, request, onCandidate, onRetry, disabled = false, compact = false, onOpen, snapshotId = null, onRefresh, actionsDisabled = false }: {
  result: MarketQueryResult;
  request: MarketQueryRequest;
  onCandidate: (value: string) => void;
  onRetry: () => void;
  disabled?: boolean;
  compact?: boolean;
  onOpen?: () => void;
  snapshotId?: string | null;
  onRefresh?: (() => void | Promise<void>) | undefined;
  actionsDisabled?: boolean;
}) {
  if (compact && result.ok) return <section className="market-preview">
    <div className="section-heading"><h3>{result.data.item.name.zhHans}</h3><span>行情</span></div>
    <p className="market-scope">{PLATFORM_LABELS[request.platform]} · {request.crossplay ? '跨平台' : '不跨平台'} · {request.rank === 'max' ? '满级' : `等级 ${request.rank}`}</p>
    <div className="preview-prices"><div><small>最低卖价</small><strong>{result.data.sellOrders[0] ? formatPlatinum(result.data.sellOrders[0].platinum) : '无卖单'}</strong></div><div><small>最高买价</small><strong>{result.data.buyOrders[0] ? formatPlatinum(result.data.buyOrders[0].platinum) : '无买单'}</strong></div></div>
    {result.warnings.map((warning) => <p className="preview-warning" key={warning.code}>{warning.message}</p>)}
    <small className="preview-source">Warframe.Market · {formatTime(result.evidence.asOf)}<br />有效至 {formatTime(result.evidence.expiresAt)}</small>
    <button className="detail-button" onClick={onOpen}>查看完整行情与订单 <Icon name="arrow" /></button>
  </section>;
  return <div className="market-result-card">
    <p className="market-scope">{PLATFORM_LABELS[request.platform]} · {request.crossplay ? '跨平台' : '不跨平台'} · {request.rank === 'max' ? '满级' : `等级 ${request.rank}`}</p>
    {result.ok ? <MarketSuccessCard result={result} snapshotId={snapshotId} onRefresh={onRefresh} disabled={disabled || actionsDisabled} /> : <>
      <MarketFailureCard result={result} onCandidate={onCandidate} onRetry={onRetry} disabled={disabled} />
    </>}
  </div>;
}
