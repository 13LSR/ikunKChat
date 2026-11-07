const UMAMI_BASE_URL = 'https://umami.331106.xyz';
const UMAMI_WEBSITE_ID = 'df97b1f0-1c5f-4592-afb9-7b00378dc438';
const UMAMI_SHARE_ID = 'MIJSOS9Fy1RefgOF';
const SHARE_CACHE_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

interface UmamiShare {
  websiteId: string;
  token: string;
}

export interface UmamiStats {
  pageviews: number;
  visitors: number;
}

class UmamiRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Umami request failed with status ${status}`);
    this.status = status;
  }
}

let sharePromise: Promise<UmamiShare> | undefined;
let shareExpiresAt = 0;

async function fetchJson(path: string, options: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${UMAMI_BASE_URL}${path}`, {
      ...options,
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new UmamiRequestError(response.status);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

function getShare(): Promise<UmamiShare> {
  if (!sharePromise || Date.now() >= shareExpiresAt) {
    shareExpiresAt = Date.now() + SHARE_CACHE_MS;
    // Keep the shared request independent of any one component's lifetime.
    const pending = fetchJson(`/api/share/${encodeURIComponent(UMAMI_SHARE_ID)}`)
      .then(data => {
        const share = data as Partial<UmamiShare> | null;
        if (share?.websiteId !== UMAMI_WEBSITE_ID || typeof share.token !== 'string' || !share.token) {
          throw new Error('Invalid Umami share response or website ID mismatch');
        }
        return { websiteId: share.websiteId, token: share.token };
      })
      .catch(error => {
        if (sharePromise === pending) sharePromise = undefined;
        throw error;
      });
    sharePromise = pending;
  }
  return sharePromise;
}

export async function getUmamiStats(signal?: AbortSignal): Promise<UmamiStats> {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    const pendingShare = getShare();
    const share = await pendingShare;
    signal?.throwIfAborted();
    const params = new URLSearchParams({
      startAt: '0',
      endAt: String(Date.now()),
      timezone: 'Asia/Shanghai',
    });

    try {
      const data = await fetchJson(`/api/websites/${share.websiteId}/stats?${params}`, {
        headers: { 'x-umami-share-token': share.token },
        signal,
      }) as Partial<UmamiStats> | null;
      if (
        typeof data?.pageviews !== 'number' || !Number.isFinite(data.pageviews) || data.pageviews < 0 ||
        typeof data?.visitors !== 'number' || !Number.isFinite(data.visitors) || data.visitors < 0
      ) {
        throw new Error('Invalid Umami stats response');
      }
      return { pageviews: data.pageviews, visitors: data.visitors };
    } catch (error) {
      if (!(error instanceof UmamiRequestError) || error.status !== 401 || attempt === 1) throw error;
      if (sharePromise === pendingShare) sharePromise = undefined;
    }
  }
  throw new Error('Unable to load Umami stats');
}
