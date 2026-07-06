import { useEffect, useMemo, useState } from 'react';

const PAGE_METER_API_BASE = 'https://views.byzxj.dpdns.org/visitor-count';
const PAGE_METER_CANONICAL_HOST = 'hjm.331106.xyz';
const PAGE_METER_HOST_ALIASES = new Set(['yx-hjm.331106.xyz', 'eo-hjm.331106.xyz']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const VISITOR_COOKIE_NAME = 'page_meter_new_visitor_hjm';
const VISITOR_STORAGE_KEY = 'page-meter-new-visitor:hjm.331106.xyz';

interface CounterSummary {
  visit_count?: number;
  visitor_count?: number;
}

interface CounterResponse {
  site?: CounterSummary;
}

interface PageMeterStats {
  siteVisits: number;
  siteVisitors: number;
}

function readCookie(name: string) {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.slice(name.length + 1));
    }
  }
  return null;
}

function writeCookie(name: string, value: string, days: number, hostname: string) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  const domain = hostname.endsWith('.331106.xyz') ? '; domain=.331106.xyz' : '';
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax${domain}${secure}`;
}

function hasTrackedNewVisitor() {
  try {
    return Boolean(readCookie(VISITOR_COOKIE_NAME) || localStorage.getItem(VISITOR_STORAGE_KEY));
  } catch {
    return Boolean(readCookie(VISITOR_COOKIE_NAME));
  }
}

function rememberNewVisitor(hostname: string) {
  writeCookie(VISITOR_COOKIE_NAME, 'true', 365, hostname);
  try {
    localStorage.setItem(VISITOR_STORAGE_KEY, 'true');
  } catch {
    // Cookie tracking is enough when localStorage is unavailable.
  }
}

function normalizeCount(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function formatCount(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function buildStats(data: CounterResponse): PageMeterStats {
  return {
    siteVisits: normalizeCount(data.site?.visit_count),
    siteVisitors: normalizeCount(data.site?.visitor_count),
  };
}

function isLocalHost(hostname: string) {
  return LOCAL_HOSTS.has(hostname);
}

function getCanonicalHost(hostname: string) {
  return PAGE_METER_HOST_ALIASES.has(hostname) ? PAGE_METER_CANONICAL_HOST : hostname;
}

function getPageMeterTarget(location: Location) {
  return `${getCanonicalHost(location.hostname)}${location.pathname || '/'}`;
}

export default function PageMeterBar() {
  const [stats, setStats] = useState<PageMeterStats | null>(null);
  const isLocalPreview = useMemo(() => isLocalHost(window.location.hostname), []);

  useEffect(() => {
    if (isLocalPreview) return;

    const controller = new AbortController();

    async function syncPageMeter() {
      const target = getPageMeterTarget(window.location);
      const baseUrl = `${PAGE_METER_API_BASE}?target=${encodeURIComponent(target)}`;
      const isNewVisitor = !hasTrackedNewVisitor();

      try {
        await fetch(baseUrl, {
          method: 'POST',
          cache: 'no-store',
          signal: controller.signal,
        });

        if (isNewVisitor) {
          await fetch(`${baseUrl}&newVisitor=true`, {
            method: 'POST',
            cache: 'no-store',
            signal: controller.signal,
          });
        }

        const response = await fetch(baseUrl, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Page meter request failed with status ${response.status}`);

        const data = await response.json() as CounterResponse;
        setStats(buildStats(data));

        if (isNewVisitor) {
          rememberNewVisitor(window.location.hostname);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('Failed to sync page meter stats.', error);
        }
      }
    }

    void syncPageMeter();
    return () => controller.abort();
  }, [isLocalPreview]);

  if (isLocalPreview) return null;

  return (
    <div className="page-meter-bar" data-page-meter aria-label="网站访问统计">
      <span>全站访客 {stats ? formatCount(stats.siteVisitors) : '--'}</span>
      <span>全站访问 {stats ? formatCount(stats.siteVisits) : '--'}</span>
    </div>
  );
}
