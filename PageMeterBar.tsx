import { useEffect, useMemo, useState } from 'react';
import { getUmamiStats, UmamiStats } from './services/umamiAnalyticsService';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function formatCount(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export default function PageMeterBar() {
  const [stats, setStats] = useState<UmamiStats | null>(null);
  const [hasError, setHasError] = useState(false);
  const isLocalPreview = useMemo(() => LOCAL_HOSTS.has(window.location.hostname), []);

  useEffect(() => {
    if (isLocalPreview) return;

    const controller = new AbortController();

    async function syncPageMeter() {
      try {
        const data = await getUmamiStats(controller.signal);
        if (!controller.signal.aborted) {
          setStats(data);
          setHasError(false);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setHasError(true);
          console.warn('Failed to load Umami stats.', error);
        }
      }
    }

    void syncPageMeter();
    return () => controller.abort();
  }, [isLocalPreview]);

  if (isLocalPreview) return null;

  return (
    <div
      className="page-meter-bar"
      data-page-meter
      aria-label="网站访问统计"
      title={hasError ? '统计暂时不可用，请稍后重试' : undefined}
    >
      <span>全站访客 {stats ? formatCount(stats.visitors) : '--'}</span>
      <span>全站访问 {stats ? formatCount(stats.pageviews) : '--'}</span>
    </div>
  );
}
