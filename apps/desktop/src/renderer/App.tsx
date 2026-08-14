import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentHealth, HealthStatus, SystemHealthSnapshot } from '../system-health.js';

const STATUS_COPY: Record<HealthStatus, { label: string; tone: string }> = {
  healthy: { label: '正常', tone: 'good' },
  degraded: { label: '降级', tone: 'warn' },
  unavailable: { label: '不可用', tone: 'bad' },
  not_configured: { label: '未配置', tone: 'idle' },
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: false,
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

export function App() {
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await window.warframeCompanion.system.getHealth());
    } catch {
      setError('无法读取本机健康快照。请重新检查桌面进程。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const healthyCount = useMemo(
    () => snapshot?.components.filter((component) => component.status === 'healthy').length ?? 0,
    [snapshot],
  );

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand__sigil">W</span><span>WARFRAME<br />COMPANION</span></div>
        <nav aria-label="主导航">
          <button className="nav-item nav-item--active" type="button"><span>⌁</span>系统概览</button>
          <button className="nav-item" type="button" disabled><span>◇</span>市场查询<small>下一阶段</small></button>
          <button className="nav-item" type="button" disabled><span>◌</span>Agent 对话<small>规划中</small></button>
        </nav>
        <div className="boundary-note">
          <span>只读模式</span>
          不操作游戏、交易、聊天或账号资产
        </div>
      </aside>

      <section className="content">
        <header className="hero">
          <div>
            <p className="eyebrow">LOCAL SYSTEM / HEALTH</p>
            <h1>系统健康</h1>
            <p className="hero__copy">一眼确认桌面端、本机集成与公共数据源是否处于可用状态。</p>
          </div>
          <button className="refresh" type="button" onClick={() => void refresh()} disabled={loading}>
            <span className={loading ? 'spin' : ''}>↻</span>{loading ? '检查中' : '重新检查'}
          </button>
        </header>

        {error ? <div className="error-banner" role="alert">{error}</div> : null}

        <section className="summary" aria-live="polite">
          <div className={`summary__orb ${snapshot?.overall === 'healthy' ? 'summary__orb--good' : ''}`}><span /></div>
          <div>
            <p>整体状态</p>
            <strong>{loading && !snapshot ? '正在建立健康快照' : snapshot?.overall === 'healthy' ? '全部系统正常' : '部分能力需要关注'}</strong>
            <small>{snapshot ? `${healthyCount} / ${snapshot.components.length} 项正常 · ${formatTime(snapshot.checkedAt)}` : '每项状态都来自本轮直接检查'}</small>
          </div>
          <div className="summary__legend"><span>新鲜证据</span><span>本机只读</span><span>无账号操作</span></div>
        </section>

        <section className="health-grid">
          {snapshot?.components.map((component) => <HealthCard key={component.id} component={component} />)}
          {loading && !snapshot ? Array.from({ length: 5 }, (_, index) => <div className="health-card skeleton" key={index} />) : null}
        </section>

        <footer>
          <span>Session 4 · 最小桌面壳</span>
          <span>状态为空不等于数据源故障；页面会明确区分。</span>
        </footer>
      </section>
    </main>
  );
}
