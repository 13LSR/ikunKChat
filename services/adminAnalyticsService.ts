export type AnalyticsRange = '24h' | '7d' | '30d' | '90d';

export interface AdminStatus {
  enabled: boolean;
  analyticsEnabled: boolean;
}

export interface AnalyticsSummary {
  requests: number;
  attempts: number;
  successes: number;
  failures: number;
  retries: number;
  successRate: number;
  avgLatencyMs: number;
}

export interface AnalyticsTimelineItem {
  bucket: string;
  requests: number;
  successes: number;
  failures: number;
  retries: number;
  attempts: number;
  failureRate: number;
  retryRate: number;
}

export interface AnalyticsChannelItem {
  routeId: string;
  routeName: string;
  provider: string;
  requests: number;
  successes: number;
  failures: number;
  avgLatencyMs: number;
}

export interface AnalyticsKeyItem {
  routeId: string;
  routeName: string;
  keyId: string;
  keyHint: string;
  attempts: number;
  successes: number;
  failures: number;
  lastUsedAt: string;
}

export interface AnalyticsRecentItem {
  id: number;
  requestId: string;
  createdAt: string;
  routeId: string;
  routeName: string;
  provider: string;
  model: string;
  upstreamModel: string;
  keyId: string;
  keyHint: string;
  attempt: number;
  status: number | null;
  success: boolean;
  durationMs: number;
  requestDurationMs: number;
  finalAttempt: boolean;
  error: string;
}

export interface AnalyticsConfiguredKey {
  id: string;
  hint: string;
}

export interface AnalyticsConfiguredRoute {
  routeId: string;
  routeName: string;
  provider: string;
  modelCount: number;
  models: string[];
  keyCount: number;
  keys: AnalyticsConfiguredKey[];
  issues?: string[];
}

export interface AnalyticsConfiguration {
  routeCount: number;
  modelCount: number;
  keyCount: number;
  routes: AnalyticsConfiguredRoute[];
  warningCount?: number;
  warnings?: string[];
}

export interface AdminAnalyticsData {
  range: AnalyticsRange;
  generatedAt: string;
  warning?: string;
  configuration?: AnalyticsConfiguration;
  summary: AnalyticsSummary;
  timeline: AnalyticsTimelineItem[];
  channels: AnalyticsChannelItem[];
  keys: AnalyticsKeyItem[];
  recent: AnalyticsRecentItem[];
}

const getWorkerApiBaseUrl = (): string =>
  ((import.meta as any).env?.VITE_WORKER_API_BASE_URL || '').trim().replace(/\/$/, '');

class AdminAnalyticsService {
  private readonly TOKEN_KEY = 'kchat-admin-token';
  private readonly EXPIRY_KEY = 'kchat-admin-token-expiry';

  getBaseUrl(): string {
    return getWorkerApiBaseUrl();
  }

  async getStatus(): Promise<AdminStatus> {
    const response = await fetch(`${this.requireBaseUrl()}/admin/status`);
    if (!response.ok) throw new Error('无法读取管理员后台状态');
    return response.json();
  }

  async login(password: string, rememberMe: boolean): Promise<void> {
    const response = await fetch(`${this.requireBaseUrl()}/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, rememberMe }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error?.message || '管理员密码错误');
    }

    const data = await response.json();
    if (typeof data?.token !== 'string') throw new Error('管理员令牌无效');

    const storage = rememberMe ? localStorage : sessionStorage;
    this.clearToken();
    storage.setItem(this.TOKEN_KEY, data.token);
    storage.setItem(this.EXPIRY_KEY, String(data.expiresAt || Date.now() + 12 * 60 * 60 * 1000));
  }

  async getAnalytics(range: AnalyticsRange, limit: number = 100): Promise<AdminAnalyticsData> {
    const token = this.getToken();
    if (!token) throw new Error('ADMIN_UNAUTHORIZED');

    const response = await fetch(
      `${this.requireBaseUrl()}/admin/analytics?range=${encodeURIComponent(range)}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (response.status === 401) {
      this.clearToken();
      throw new Error('ADMIN_UNAUTHORIZED');
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error?.message || `后台数据请求失败 (${response.status})`);
    }

    return response.json();
  }

  isAuthenticated(): boolean {
    return Boolean(this.getToken());
  }

  logout(): void {
    this.clearToken();
  }

  private getToken(): string | null {
    const token = localStorage.getItem(this.TOKEN_KEY) || sessionStorage.getItem(this.TOKEN_KEY);
    const expiry = Number(localStorage.getItem(this.EXPIRY_KEY) || sessionStorage.getItem(this.EXPIRY_KEY) || 0);

    if (!token || !expiry || Date.now() >= expiry) {
      this.clearToken();
      return null;
    }

    return token;
  }

  private clearToken(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.EXPIRY_KEY);
    sessionStorage.removeItem(this.TOKEN_KEY);
    sessionStorage.removeItem(this.EXPIRY_KEY);
  }

  private requireBaseUrl(): string {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) throw new Error('未配置 VITE_WORKER_API_BASE_URL');
    return baseUrl;
  }
}

export const adminAnalyticsService = new AdminAnalyticsService();
