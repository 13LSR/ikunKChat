import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, IconName } from '../Icon';
import {
  adminAnalyticsService,
  AdminAnalyticsData,
  AnalyticsConfiguredRoute,
  AnalyticsKeyItem,
  AnalyticsRange,
  AnalyticsTimelineItem,
} from '../../services/adminAnalyticsService';

interface AdminDashboardProps {
  onUnauthorized: () => void;
  onLogout: () => void;
}

interface KeyCoverageItem {
  routeId: string;
  routeName: string;
  provider: string;
  keyId: string;
  keyHint: string;
  usage?: AnalyticsKeyItem;
}

const RANGE_OPTIONS: Array<{ value: AnalyticsRange; label: string }> = [
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: '90d', label: '90 天' },
];

const numberFormatter = new Intl.NumberFormat('zh-CN');
const STALE_REFRESH_MS = 60_000;

const formatNumber = (value: number) => numberFormatter.format(Number(value || 0));

const formatLatency = (value: number) => {
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
};

const formatDateTime = (value?: string) => {
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

const getCoverageRate = (used: number, total: number) =>
  total > 0 ? Math.round((used / total) * 1000) / 10 : 0;

const getRouteUsageKey = (routeId: string, keyId: string) => `${routeId}:${keyId}`;

const getKeyHealth = (attempts: number, successes: number) => {
  const successRate = getSuccessRate(successes, attempts);
  if (attempts === 0) return 'idle';
  if (successRate >= 95) return 'healthy';
  if (successRate >= 70) return 'warning';
  return 'danger';
};

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
            <stop offset="0%" stopColor="var(--admin-accent)" stopOpacity="0.34" />
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

var TrendHealthChart: React.FC<{ items: AnalyticsTimelineItem[] }> = ({ items }) => {
  if (items.length === 0) return null;

  const width = 720;
  const height = 90;
  const padding = 8;
  const latest = items[items.length - 1];
  const toPoints = (values: number[], maxValue: number) => values.map((value, index) => {
    const x = padding + (items.length === 1 ? (width - padding * 2) / 2 : (index / (items.length - 1)) * (width - padding * 2));
    const y = padding + (height - padding * 2) - (value / maxValue) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="admin-trend-health">
      <div className="admin-trend-health-row">
        <span><i className="admin-trend-dot requests" />请求量</span>
        <strong>{formatNumber(Number(latest.requests || 0))}</strong>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="失败率与重试率趋势">
        <polyline points={toPoints(items.map((item) => Number(item.failureRate || 0)), 100)} className="admin-health-line failure" />
        <polyline points={toPoints(items.map((item) => Number(item.retryRate || 0)), 100)} className="admin-health-line retry" />
      </svg>
      <div className="admin-trend-health-legend">
        <span><i className="admin-trend-dot failure" />失败率 {Number(latest.failureRate || 0)}%</span>
        <span><i className="admin-trend-dot retry" />重试率 {Number(latest.retryRate || 0)}%</span>
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

const ConfigRouteCard: React.FC<{ route: AnalyticsConfiguredRoute; isUsed: boolean }> = ({ route, isUsed }) => (
  <article className="admin-config-route">
    <div>
      <strong>{route.routeName}</strong>
      <span>{route.routeId} · {route.provider}</span>
      {route.issues?.length ? <small className="admin-config-route-issues">{route.issues.join('；')}</small> : null}
    </div>
    <div className="admin-config-route-meta">
      <span>{route.modelCount} 模型</span>
      <span>{route.keyCount} Key</span>
      <span className={isUsed ? 'admin-chip-success' : 'admin-chip-muted'}>{isUsed ? '有调用' : '未调用'}</span>
    </div>
  </article>
);

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onUnauthorized, onLogout }) => {
  const [range, setRange] = useState<AnalyticsRange>('24h');
  const [data, setData] = useState<AdminAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [isOpsMode, setIsOpsMode] = useState(false);
  const [keyRouteFilter, setKeyRouteFilter] = useState('all');
  const [keyStatusFilter, setKeyStatusFilter] = useState<'all' | 'healthy' | 'warning' | 'danger' | 'idle'>('all');
  const [showUnusedKeys, setShowUnusedKeys] = useState(false);
  const [activityRouteFilter, setActivityRouteFilter] = useState('all');
  const [activityStatusFilter, setActivityStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const requestIdRef = useRef(0);

  const loadAnalytics = useCallback(async (silent: boolean = false) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    setError('');

    try {
      const nextData = await adminAnalyticsService.getAnalytics(range);
      if (requestIdRef.current !== requestId) return;
      setData(nextData);
      setLastLoadedAt(Date.now());
    } catch (loadError) {
      if (requestIdRef.current !== requestId) return;
      const message = loadError instanceof Error ? loadError.message : '数据加载失败';
      if (message === 'ADMIN_UNAUTHORIZED') {
        onUnauthorized();
        return;
      }
      setError(message);
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [onUnauthorized, range]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    const handleFocus = () => {
      if (!lastLoadedAt || Date.now() - lastLoadedAt > STALE_REFRESH_MS) {
        void loadAnalytics(true);
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [lastLoadedAt, loadAnalytics]);

  const filteredRecent = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (data?.recent || []).filter((item) => {
      const matchesSearch = !normalizedSearch || [
        item.routeName,
        item.provider,
        item.model,
        item.keyId,
        item.keyHint,
        item.status,
      ].some((value) => String(value ?? '').toLowerCase().includes(normalizedSearch));
      const matchesRoute = activityRouteFilter === 'all' || item.routeId === activityRouteFilter;
      const matchesStatus = activityStatusFilter === 'all'
        || (activityStatusFilter === 'success' && item.success)
        || (activityStatusFilter === 'failed' && !item.success);
      return matchesSearch && matchesRoute && matchesStatus;
    });
  }, [activityRouteFilter, activityStatusFilter, data?.recent, search]);

  const configuration = data?.configuration;
  const usageByRoute = useMemo(
    () => new Map((data?.channels || []).map((channel) => [channel.routeId, channel])),
    [data?.channels]
  );
  const usageByKey = useMemo(
    () => new Map((data?.keys || []).map((key) => [getRouteUsageKey(key.routeId, key.keyId), key])),
    [data?.keys]
  );
  const configuredRoutes = configuration?.routes || [];
  const configuredKeyItems = useMemo<KeyCoverageItem[]>(() => {
    if (configuredRoutes.length === 0) {
      return (data?.keys || []).map((key) => ({
        routeId: key.routeId,
        routeName: key.routeName,
        provider: '',
        keyId: key.keyId,
        keyHint: key.keyHint,
        usage: key,
      }));
    }

    return configuredRoutes.flatMap((route) =>
      route.keys.map((key) => ({
        routeId: route.routeId,
        routeName: route.routeName,
        provider: route.provider,
        keyId: key.id,
        keyHint: key.hint,
        usage: usageByKey.get(getRouteUsageKey(route.routeId, key.id)),
      }))
    );
  }, [configuredRoutes, data?.keys, usageByKey]);

  const usedRouteCount = configuredRoutes.filter((route) => usageByRoute.has(route.routeId)).length;
  const usedKeyCount = configuredKeyItems.filter((key) => key.usage).length;
  const configuredKeyCount = configuration?.keyCount ?? configuredKeyItems.length;
  const keyCoverageRate = getCoverageRate(usedKeyCount, configuredKeyCount);
  const unusedKeyCount = Math.max(configuredKeyCount - usedKeyCount, 0);
  const missingKeyRoutes = configuredRoutes.filter((route) => route.keyCount === 0);
  const peakChannel = data?.channels[0];
  const filteredKeyItems = useMemo(() => {
    return [...configuredKeyItems]
      .filter((key) => keyRouteFilter === 'all' || key.routeId === keyRouteFilter)
      .filter((key) => {
        if (keyStatusFilter === 'all') return true;
        const attempts = Number(key.usage?.attempts || 0);
        const successes = Number(key.usage?.successes || 0);
        return getKeyHealth(attempts, successes) === keyStatusFilter;
      })
      .sort((left, right) => {
        const leftAttempts = Number(left.usage?.attempts || 0);
        const rightAttempts = Number(right.usage?.attempts || 0);
        const leftFailures = Number(left.usage?.failures || 0);
        const rightFailures = Number(right.usage?.failures || 0);
        return rightFailures - leftFailures || rightAttempts - leftAttempts || left.keyId.localeCompare(right.keyId);
      });
  }, [configuredKeyItems, keyRouteFilter, keyStatusFilter]);
  const visibleKeyItems = showUnusedKeys
    ? filteredKeyItems
    : filteredKeyItems.filter((key) => key.usage).concat(
      filteredKeyItems.filter((key) => !key.usage).slice(0, 4)
    );
  const hiddenKeyCount = Math.max(filteredKeyItems.length - visibleKeyItems.length, 0);

  const channelRows = configuredRoutes.length > 0
    ? configuredRoutes.map((route) => ({ route, usage: usageByRoute.get(route.routeId) }))
    : (data?.channels || []).map((channel) => ({
      route: {
        routeId: channel.routeId,
        routeName: channel.routeName,
        provider: channel.provider,
        modelCount: 0,
        models: [],
        keyCount: 0,
        keys: [],
      },
      usage: channel,
    }));

  return (
    <main className={`admin-dashboard-shell ${isOpsMode ? 'admin-ops-mode' : ''}`}>
      <header className="admin-topbar">
        <div className="admin-topbar-brand">
          <div className="admin-brand-mark admin-brand-mark-small"><Icon icon="chip" /></div>
          <div>
            <strong>ikunKChat</strong>
            <span>AI 调用控制中心</span>
          </div>
        </div>
        <div className="admin-topbar-actions">
          <button type="button" className={`admin-ghost-button ${isOpsMode ? 'active' : ''}`} onClick={() => setIsOpsMode((value) => !value)}>
            {isOpsMode ? '退出运维模式' : '运维模式'}
          </button>
          <a href="/" className="admin-ghost-button">返回聊天</a>
          <button type="button" className="admin-ghost-button" onClick={onLogout}>退出后台</button>
        </div>
      </header>

      <div className="admin-dashboard-content">
        <section className="admin-page-heading">
          <div>
            <p className="admin-eyebrow">OVERVIEW</p>
            <h1>AI 调用概览</h1>
            <p>后台不再定时轮询，只在进入、切换时间范围、手动刷新或页面重新聚焦且数据超过 60 秒时请求。</p>
          </div>
          <div className="admin-heading-controls">
            <span className="admin-refresh-hint">上次更新：{formatDateTime(data?.generatedAt)}</span>
            <select value={range} onChange={(event) => setRange(event.target.value as AnalyticsRange)}>
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button type="button" className="admin-refresh-button" onClick={() => void loadAnalytics(true)} disabled={isRefreshing}>
              <Icon icon="regenerate" />
              {isRefreshing ? '刷新中' : '手动刷新'}
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
            {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="admin-skeleton-card" />)}
          </section>
        ) : data ? (
          <>
            <section className="admin-stat-grid">
              <StatCard label="用户请求" value={formatNumber(data.summary.requests)} detail={`${formatNumber(data.summary.attempts)} 次上游尝试`} icon="message-square" />
              <StatCard label="成功率" value={`${data.summary.successRate}%`} detail={`${formatNumber(data.summary.successes)} 次成功`} icon="check-circle" tone="success" />
              <StatCard label="失败请求" value={formatNumber(data.summary.failures)} detail="最终尝试仍未成功" icon="alert-circle" tone={data.summary.failures > 0 ? 'warning' : 'default'} />
              <StatCard label="Key 切换" value={formatNumber(data.summary.retries)} detail="限流或错误触发重试" icon="arrow-left-right" />
              <StatCard label="Key 覆盖" value={`${keyCoverageRate}%`} detail={`${usedKeyCount}/${configuredKeyCount} 个 Key 有调用`} icon="chip" tone={unusedKeyCount > 0 ? 'warning' : 'success'} />
              <StatCard label="平均响应" value={formatLatency(data.summary.avgLatencyMs)} detail="包含重试累计耗时" icon="history" />
            </section>

            <section className="admin-overview-grid">
              <article className="admin-panel admin-trend-panel">
                <div className="admin-panel-header">
                  <div><p className="admin-panel-kicker">REQUEST TREND</p><h2>请求趋势</h2></div>
                  <span>{data.timeline.length} 个时间区间</span>
                </div>
                <TrendChart items={data.timeline} />
                <TrendHealthChart items={data.timeline} />
              </article>

              <aside className="admin-panel admin-summary-panel">
                <div className="admin-panel-header">
                  <div><p className="admin-panel-kicker">CONFIG SUMMARY</p><h2>配置摘要</h2></div>
                </div>
                <div className="admin-signal-list">
                  <div><span>已配置渠道</span><strong>{formatNumber(configuration?.routeCount ?? data.channels.length)}</strong></div>
                  <div><span>已配置模型</span><strong>{formatNumber(configuration?.modelCount ?? 0)}</strong></div>
                  <div><span>已配置 Key</span><strong>{formatNumber(configuredKeyCount)}</strong></div>
                  <div><span>本范围活跃渠道</span><strong>{formatNumber(usedRouteCount || data.channels.length)}</strong></div>
                  <div><span>最繁忙渠道</span><strong>{peakChannel?.routeName || '暂无'}</strong></div>
                </div>
                {missingKeyRoutes.length > 0 && (
                  <div className="admin-inline-alert admin-inline-alert-warning">
                    {missingKeyRoutes.length} 个渠道未配置 Key，请检查 <code>AI_ROUTES_JSON</code>。
                  </div>
                )}
                {configuration?.warnings?.length ? (
                  <div className="admin-config-warnings">
                    <strong>配置体检：{configuration.warningCount || configuration.warnings.length} 项提醒</strong>
                    <ul>
                      {configuration.warnings.slice(0, isOpsMode ? configuration.warnings.length : 4).map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                    {!isOpsMode && configuration.warnings.length > 4 && (
                      <span>进入运维模式可查看全部提醒。</span>
                    )}
                  </div>
                ) : null}
                {data.warning ? (
                  <div className="admin-inline-alert admin-inline-alert-warning">
                    {data.warning}
                  </div>
                ) : null}
              </aside>
            </section>

            {configuredRoutes.length > 0 && (
              <section className="admin-panel">
                <div className="admin-panel-header">
                  <div><p className="admin-panel-kicker">ROUTE CONFIG</p><h2>渠道配置覆盖</h2></div>
                  <span>{usedRouteCount}/{configuredRoutes.length} 个渠道在当前范围有调用</span>
                </div>
                <div className="admin-config-grid">
                  {configuredRoutes.map((route) => (
                    <ConfigRouteCard key={route.routeId} route={route} isUsed={usageByRoute.has(route.routeId)} />
                  ))}
                </div>
              </section>
            )}

            <section className="admin-panel">
              <div className="admin-panel-header">
                <div><p className="admin-panel-kicker">CHANNELS</p><h2>渠道表现</h2></div>
                <span>配置 + 当前时间范围调用统计</span>
              </div>
              {channelRows.length === 0 ? (
                <div className="admin-empty-state">暂无渠道配置或调用数据。</div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-data-table">
                    <thead><tr><th>渠道</th><th>类型</th><th>配置</th><th>请求</th><th>成功率</th><th>平均响应</th><th>失败</th></tr></thead>
                    <tbody>
                      {channelRows.map(({ route, usage }) => {
                        const successRate = getSuccessRate(Number(usage?.successes || 0), Number(usage?.requests || 0));
                        return (
                          <tr key={route.routeId}>
                            <td><strong>{route.routeName}</strong><span>{route.routeId}</span></td>
                            <td><span className="admin-provider-badge">{route.provider}</span></td>
                            <td><span>{route.modelCount || '—'} 模型</span><span>{route.keyCount || '—'} Key</span></td>
                            <td>{formatNumber(Number(usage?.requests || 0))}</td>
                            <td><div className="admin-rate-cell"><span>{successRate}%</span><div><i style={{ width: `${successRate}%` }} /></div></div></td>
                            <td>{usage ? formatLatency(Number(usage.avgLatencyMs)) : '—'}</td>
                            <td className={Number(usage?.failures || 0) > 0 ? 'admin-text-danger' : ''}>{formatNumber(Number(usage?.failures || 0))}</td>
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
                <div><p className="admin-panel-kicker">KEY COVERAGE</p><h2>API Key 覆盖状态</h2></div>
                <span>只显示 Key ID 与掩码，不返回原始密钥</span>
              </div>
              {configuredKeyItems.length === 0 ? (
                <div className="admin-empty-state">暂无 Key 配置或使用记录。</div>
              ) : (
                <>
                  <div className="admin-filter-row">
                    <select value={keyRouteFilter} onChange={(event) => setKeyRouteFilter(event.target.value)}>
                      <option value="all">全部渠道</option>
                      {configuredRoutes.map((route) => <option key={route.routeId} value={route.routeId}>{route.routeName}</option>)}
                    </select>
                    <select value={keyStatusFilter} onChange={(event) => setKeyStatusFilter(event.target.value as typeof keyStatusFilter)}>
                      <option value="all">全部状态</option>
                      <option value="danger">失败 Key</option>
                      <option value="warning">需关注</option>
                      <option value="healthy">健康</option>
                      <option value="idle">未使用</option>
                    </select>
                    <button type="button" className="admin-filter-button" onClick={() => setShowUnusedKeys((value) => !value)}>
                      {showUnusedKeys ? '收起未使用 Key' : `显示全部 Key${hiddenKeyCount ? `（${hiddenKeyCount}）` : ''}`}
                    </button>
                  </div>
                  <div className="admin-key-grid">
                  {visibleKeyItems.map((key) => {
                    const attempts = Number(key.usage?.attempts || 0);
                    const successes = Number(key.usage?.successes || 0);
                    const failures = Number(key.usage?.failures || 0);
                    const successRate = getSuccessRate(successes, attempts);
                    const health = getKeyHealth(attempts, successes);

                    return (
                      <article key={`${key.routeId}:${key.keyId}`} className={`admin-key-card admin-key-${health}`}>
                        <div className="admin-key-card-head">
                          <div className="admin-key-icon"><Icon icon="chip" /></div>
                          <div><strong>{key.keyId}</strong><span>{key.routeName}</span></div>
                          <span className={`admin-health-dot ${health}`} />
                        </div>
                        <code>{key.keyHint}</code>
                        <div className="admin-key-metrics">
                          <div><span>调用</span><strong>{formatNumber(attempts)}</strong></div>
                          <div><span>成功率</span><strong>{attempts > 0 ? `${successRate}%` : '未覆盖'}</strong></div>
                          <div><span>失败</span><strong>{formatNumber(failures)}</strong></div>
                        </div>
                        <p>{attempts > 0 ? `最后使用：${formatDateTime(key.usage?.lastUsedAt)}` : '当前时间范围内尚未使用'}</p>
                      </article>
                    );
                  })}
                  </div>
                </>
              )}
            </section>

            <section className="admin-panel">
              <div className="admin-panel-header admin-panel-header-search">
                <div className="admin-activity-filters">
                  <select value={activityRouteFilter} onChange={(event) => setActivityRouteFilter(event.target.value)}>
                    <option value="all">全部渠道</option>
                    {configuredRoutes.map((route) => <option key={route.routeId} value={route.routeId}>{route.routeName}</option>)}
                  </select>
                  <select value={activityStatusFilter} onChange={(event) => setActivityStatusFilter(event.target.value as typeof activityStatusFilter)}>
                    <option value="all">全部状态</option>
                    <option value="success">成功</option>
                      <option value="failed">失败</option>
                    </select>
                  </div>
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
