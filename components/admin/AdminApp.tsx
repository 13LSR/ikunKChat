import React, { useEffect, useState } from 'react';
import { Icon } from '../Icon';
import {
  adminAnalyticsService,
  AdminStatus,
} from '../../services/adminAnalyticsService';
import { AdminDashboard } from './AdminDashboard';
import './AdminDashboard.css';

const AdminApp: React.FC = () => {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(() => adminAnalyticsService.isAuthenticated());
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    adminAnalyticsService.getStatus()
      .then(setStatus)
      .catch((statusError) => setError(statusError.message || '后台服务不可用'));
  }, []);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      await adminAnalyticsService.login(password, rememberMe);
      setPassword('');
      setIsAuthenticated(true);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    adminAnalyticsService.logout();
    setIsAuthenticated(false);
  };

  if (isAuthenticated) {
    return <AdminDashboard onUnauthorized={() => setIsAuthenticated(false)} onLogout={handleLogout} />;
  }

  return (
    <main className="admin-login-shell">
      <section className="admin-login-card">
        <div className="admin-brand-mark">
          <Icon icon="chip" className="admin-brand-icon" />
        </div>
        <p className="admin-eyebrow">IKUNKCHAT CONTROL CENTER</p>
        <h1>管理员数据后台</h1>
        <p className="admin-login-copy">查看 AI 渠道、模型、Key 轮询与请求健康状态。</p>

        {status && !status.enabled && (
          <div className="admin-inline-alert admin-inline-alert-warning">
            Worker 尚未配置 <code>ADMIN_PASSWORD</code>。
          </div>
        )}

        {status && !status.analyticsEnabled && (
          <div className="admin-inline-alert admin-inline-alert-warning">
            Worker 尚未绑定 <code>ANALYTICS_DB</code>，登录后无法读取统计数据。
          </div>
        )}

        <form onSubmit={handleLogin} className="admin-login-form">
          <label htmlFor="admin-password">管理员密码</label>
          <div className="admin-password-field">
            <Icon icon="settings" className="admin-field-icon" />
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="输入 ADMIN_PASSWORD"
              autoFocus
              autoComplete="current-password"
            />
          </div>

          <label className="admin-remember-row">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            <span>在此设备保持登录 7 天</span>
          </label>

          {error && <div className="admin-inline-alert admin-inline-alert-error">{error}</div>}

          <button type="submit" className="admin-primary-button" disabled={isSubmitting || status?.enabled === false}>
            {isSubmitting ? '正在验证…' : '进入数据后台'}
          </button>
        </form>

        <a href="/" className="admin-back-link">返回聊天首页</a>
      </section>
    </main>
  );
};

export default AdminApp;
