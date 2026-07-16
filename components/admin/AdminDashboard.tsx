import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from '../Icon';
import {
  adminAnalyticsService,
  AdminAnalyticsData,
  AnalyticsRange,
  AnalyticsTimelineItem,
} from '../../services/adminAnalyticsService';

interface AdminDashboardProps {
  onUnauthorized: () => void;
  onLogout: () => void;
}

const RANGE_OPTIONS: Array<{ value: AnalyticsRange; label: string }> = [
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: '90d', label: '90 天' },
];

const numberFormatter = new Intl.NumberFormat('zh-CN');

const formatNumber = (value: number) => numberFormatter.format(Number(value || 0));

const formatLatency = (value: number) => {
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
};

const formatDateTime = (value: string) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
};

const getSuccessRate = (successes: number, attempts: number) =>
  attempts > 0 ? Math.round((successes / attempts) * 1000) / 10 : 0;

const TrendChart: React.FC<{ items: AnalyticsTimelineItem[] }> = ({ items }) => {
  if (items.length === 0) {
    return <div className="admin-chart-empty">暂无趋势数据，完成一次 AI 调用后会显示曲线。</div>;
  }

  const width = 720;
  const height = 230;
  const paddingX = 18;
  const paddingY = 24;
  const maxValue = Math.max(...items.map((item) => Number(item.requests || 0)), 1);
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const points = items.map((item, index) => {
    const x = paddingX + (items.length === 1 ? usableWidth / 2 : (index / (items.length - 1)) * usableWidth);
    const y = paddingY + usableHeight - (Number(item.requests || 0) / maxValue) * usableHeight;
    return { x, y, item };
  });
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ');
  const areaPoints = `${paddingX},${height - paddingY} ${linePoints} ${width - paddingX},${height - paddingY}`;

  return (
    <div className="admin-trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="AI 请求趋势图">
        <defs>
          <linearGradient id="adminTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--admin-accent)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--admin-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => {
          const y = paddingY + (usableHeight / 3) * line;
          return <line key={line} x1={paddingX} y1={y} x2={width - paddingX} y2={y} className="admin-chart-grid" />;
        })}
        <polygon points={areaPoints} fill="url(#adminTrendFill)" />
        <polyline points={linePoints} className="admin-chart-line" />
        {points.map((point) => (
          <circle key={point.item.bucket} cx={point.x} cy={point.y} r="4" className="admin-chart-point">
            <title>{`${formatDateTime(point.item.bucket)}：${point.item.requests} 次请求`}</title>
          </circle>
        ))}
      </svg>
      <div className="admin-chart-axis">
        <span>{formatDateTime(items[0]?.bucket)}</span>
        <span>{formatDateTime(items[items.length - 1]?.bucket)}</span>
      </div>
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: string;
  detail: string;
  icon: IconName;
  tone?: 'default' | 'success' | 'warning';
}> = ({ label, value, detail, icon, tone = 'default' }) => (
  <article className={`admin-stat-card admin-stat-${tone}`}>
    <div className="admin-stat-icon"><Icon icon={icon} /></div>
    <div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  </article>
);

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onUnauthorized, onLogout }) => {
  const [range, setRange] = useState<AnalyticsRange>('24h');
  const [data, setData] = useState<AdminAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const loadAnalytics = useCallback(async (silent: boolean = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    setError('');

    try {
      const nextData = await adminAnalyticsService.getAnalytics(range);
      setData(nextData);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : '数据加载失败';
      if (message === 'ADMIN_UNAUTHORIZED') {
        onUnauthorized();
        return;
      }
      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [onUnauthorized, range]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    if (!isLive) return undefined;
    const timer = window.setInterval(() => void loadAnalytics(true), 10000);
    return () => window.clearInterval(timer);
  }, [isLive, loadAnalytics]);

  const filteredRecent = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return data?.recent || [];
    return (data?.recent || []).filter((item) =>
      [item.routeName, item.provider, item.model, item.keyId, item.keyHint, item.status]
        .some((value) => String(value ?? '').toLowerCase().includes(normalizedSearch))
    );
  }, [data?.recent, search]);

  const peakChannel = data?.channels[0];

  return (
    <main className="admin-dashboard-shell">
      <header className="admin-topbar">
        <div className="admin-topbar-brand">
          <div className="admin-brand-mark admin-brand-mark-small"><Icon icon="chip" /></div>
          <div>
            <strong>ikunKChat</strong>
            <span>AI 调用控制中心</span>
          </div>
        </div>
        <div className="admin-topbar-actions">
          <a href="/" className="admin-ghost-button">返回聊天</a>
          <button type="button" className="admin-ghost-button" onClick={onLogout}>退出后台</button>
        </div>
      </header>

      <div className="admin-dashboard-content">
        <section className="admin-page-heading">
          <div>
            <p className="admin-eyebrow">OVERVIEW</p>
            <h1>AI 调用概览</h1>
            <p>追踪每个渠道、模型和轮询 Key 的实时调用情况。</p>
          </div>
          <div className="admin-heading-controls">
            <label className="admin-live-toggle">
              <input type="checkbox" checked={isLive} onChange={(event) => setIsLive(event.target.checked)} />
              <span className="admin-live-dot" />
              {isLive ? '实时刷新' : '已暂停'}
            </label>
            <select value={range} onChange={(event) => setRange(event.target.value as AnalyticsRange)}>
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button type="button" className="admin-refresh-button" onClick={() => void loadAnalytics(true)} disabled={isRefreshing}>
              <Icon icon="regenerate" />
              {isRefreshing ? '刷新中' : '刷新'}
            </button>
          </div>
        </section>

        {error && (
          <section className="admin-state-card admin-state-error">
            <Icon icon="alert-circle" />
            <div><strong>无法读取统计数据</strong><p>{error}</p></div>
            <button type="button" onClick={() => void loadAnalytics()}>重试</button>
          </section>
        )}

        {isLoading && !data ? (
          <section className="admin-loading-grid">
            {[0, 1, 2, 3, 4].map((item) => <div key={item} className="admin-skeleton-card" />)}
          </section>
        ) : data ? (
          <>
            <section className="admin-stat-grid">
              <StatCard label="用户请求" value={formatNumber(data.summary.requests)} detail={`${formatNumber(data.summary.attempts)} 次上游尝试`} icon="message-square" />
              <StatCard label="成功率" value={`${data.summary.successRate}%`} detail={`${formatNumber(data.summary.successes)} 次成功`} icon="check-circle" tone="success" />
              <StatCard label="失败请求" value={formatNumber(data.summary.failures)} detail="最终尝试仍未成功" icon="alert-circle" tone={data.summary.failures > 0 ? 'warning' : 'default'} />
              <StatCard label="Key 切换" value={formatNumber(data.summary.retries)} detail="限流或错误触发重试" icon="arrow-left-right" />
              <StatCard label="平均响应" value={formatLatency(data.summary.avgLatencyMs)} detail="包含重试累计耗时" icon="history" />
            </section>

            <section className="admin-overview-grid">
              <article className="admin-panel admin-trend-panel">
                <div className="admin-panel-header">
                  <div><p className="admin-panel-kicker">REQUEST TREND</p><h2>请求趋势</h2></div>
                  <span>{data.timeline.length} 个时间区间</span>
                </div>
                <TrendChart items={data.timeline} />
              </article>

              <aside className="admin-panel admin-summary-panel">
                <div className="admin-panel-header">
                  <div><p className="admin-panel-kicker">CURRENT SIGNAL</p><h2>运行信号</h2></div>
                </div>
                <div className="admin-signal-list">
                  <div><span>最繁忙渠道</span><strong>{peakChannel?.routeName || '暂无'}</strong></div>
                  <div><span>已配置渠道</span><strong>{data.channels.length}</strong></div>
                  <div><span>活跃 Key</span><strong>{data.keys.length}</strong></div>
                  <div><span>最后更新</span><strong>{formatDateTime(data.generatedAt)}</strong></div>
                </div>
              </aside>
            </section>

            <section className="admin-panel">
              <div className="admin-panel-header">
                <div><p className="admin-panel-kicker">CHANNELS</p><h2>渠道表现</h2></div>
                <span>按最终请求统计</span>
              </div>
              {data.channels.length === 0 ? (
                <div className="admin-empty-state">暂无渠道调用数据。</div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-data-table">
                    <thead><tr><th>渠道</th><th>类型</th><th>请求</th><th>成功率</th><th>平均响应</th><th>失败</th></tr></thead>
                    <tbody>
                      {data.channels.map((channel) => {
                        const successRate = getSuccessRate(Number(channel.successes), Number(channel.requests));
                        return (
                          <tr key={channel.routeId}>
                            <td><strong>{channel.routeName}</strong><span>{channel.routeId}</span></td>
                            <td><span className="admin-provider-badge">{channel.provider}</span></td>
                            <td>{formatNumber(channel.requests)}</td>
                            <td><div className="admin-rate-cell"><span>{successRate}%</span><div><i style={{ width: `${successRate}%` }} /></div></div></td>
                            <td>{formatLatency(Number(channel.avgLatencyMs))}</td>
                            <td className={Number(channel.failures) > 0 ? 'admin-text-danger' : ''}>{formatNumber(channel.failures)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="admin-panel">
              <div className="admin-panel-header">
                <div><p className="admin-panel-kicker">KEY HEALTH</p><h2>API Key 使用情况</h2></div>
                <span>仅显示 Key ID 与掩码</span>
              </div>
              {data.keys.length === 0 ? (
                <div className="admin-empty-state">暂无 Key 使用记录。</div>
              ) : (
                <div className="admin-key-grid">
                  {data.keys.map((key) => {
                    const successRate = getSuccessRate(Number(key.successes), Number(key.attempts));
                    return (
                      <article key={`${key.routeId}:${key.keyId}`} className="admin-key-card">
                        <div className="admin-key-card-head">
                          <div className="admin-key-icon"><Icon icon="chip" /></div>
                          <div><strong>{key.keyId}</strong><span>{key.routeName}</span></div>
                          <span className={`admin-health-dot ${successRate >= 95 ? 'healthy' : successRate >= 70 ? 'warning' : 'danger'}`} />
                        </div>
                        <code>{key.keyHint}</code>
                        <div className="admin-key-metrics">
                          <div><span>调用</span><strong>{formatNumber(key.attempts)}</strong></div>
                          <div><span>成功率</span><strong>{successRate}%</strong></div>
                          <div><span>失败</span><strong>{formatNumber(key.failures)}</strong></div>
                        </div>
                        <p>最后使用：{formatDateTime(key.lastUsedAt)}</p>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="admin-panel">
              <div className="admin-panel-header admin-panel-header-search">
                <div><p className="admin-panel-kicker">ACTIVITY</p><h2>最近调用明细</h2></div>
                <div className="admin-search-field"><Icon icon="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索渠道、模型、Key、状态码" /></div>
              </div>
              {filteredRecent.length === 0 ? (
                <div className="admin-empty-state">没有符合条件的调用记录。</div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-data-table admin-activity-table">
                    <thead><tr><th>时间</th><th>渠道 / 模型</th><th>使用 Key</th><th>尝试</th><th>状态</th><th>耗时</th></tr></thead>
                    <tbody>
                      {filteredRecent.map((item) => (
                        <tr key={item.id}>
                          <td>{formatDateTime(item.createdAt)}</td>
                          <td><strong>{item.routeName}</strong><span>{item.model}{item.upstreamModel !== item.model ? ` → ${item.upstreamModel}` : ''}</span></td>
                          <td><strong>{item.keyId}</strong><code>{item.keyHint}</code></td>
                          <td><span className="admin-attempt-badge">#{item.attempt}{item.finalAttempt ? ' 最终' : ' 重试'}</span></td>
                          <td><span className={`admin-status-badge ${item.success ? 'success' : 'failed'}`}>{item.status ?? '网络错误'}</span>{item.error && <small title={item.error}>{item.error}</small>}</td>
                          <td>{formatLatency(Number(item.durationMs))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
};
