import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

const CHARITY_API_URL = 'https://api.isoyu.com/gy/api.php';
const CHARITY_CACHE_KEY = 'charity-ad-widget-cache-v1';
const CHARITY_CACHE_VERSION = 2;
const CHARITY_DISMISS_KEY = 'charity-ad-widget-dismiss-until';
const CHARITY_CACHE_TTL = 1000 * 60 * 60 * 6;
const CHARITY_ITEM_COUNT = 5;
const CHARITY_MAX_FETCH_ATTEMPTS = 8;
const CHARITY_MAX_CONSECUTIVE_FETCH_FAILURES = 2;
const CHARITY_FETCH_PAUSE_MS = 180;
const CHARITY_FETCH_TIMEOUT_MS = 6500;
const CHARITY_REFRESH_COOLDOWN_KEY = 'charity-ad-widget-refresh-cooldown-until';
const CHARITY_REFRESH_FAILURE_COOLDOWN_MS = 1000 * 60 * 30;
const POPOVER_GAP = 10;
const POPOVER_VIEWPORT_PADDING = 12;
const POPOVER_CLOSE_DELAY = 140;

interface CharityApiItem {
  id?: string;
  name?: string;
  sex?: string;
  birth_time?: string;
  lost_time?: string;
  child_pic?: string;
  lost_place?: string;
  url?: string;
  child_feature?: string;
}

interface CharityApiResponse {
  success?: boolean;
  data?: CharityApiItem;
}

interface CharityCache {
  version?: number;
  expiresAt: number;
  savedAt?: number;
  items: CharityApiItem[];
}

interface CachedItemsResult {
  fresh: boolean;
  items: CharityApiItem[];
}

interface PopoverPosition {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

interface FetchCharityItemsResult {
  items: CharityApiItem[];
  freshItemCount: number;
}

interface CharityAdWidgetProps {
  hidden?: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getNameInitial(item: CharityApiItem) {
  return item.name?.trim().slice(0, 1) || '?';
}

function isTouchLikePointer() {
  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

function normalizeItem(item: CharityApiItem | undefined): CharityApiItem | null {
  if (!item?.id || !item.name || !item.child_pic) return null;
  return {
    id: String(item.id),
    name: String(item.name),
    sex: item.sex ? String(item.sex) : '',
    birth_time: item.birth_time ? String(item.birth_time) : '',
    lost_time: item.lost_time ? String(item.lost_time) : '',
    child_pic: String(item.child_pic),
    lost_place: item.lost_place ? String(item.lost_place) : '',
    url: item.url ? String(item.url) : '',
    child_feature: item.child_feature ? String(item.child_feature) : '',
  };
}

function readCachedItems(): CachedItemsResult {
  try {
    const raw = localStorage.getItem(CHARITY_CACHE_KEY);
    if (!raw) return { fresh: false, items: [] };
    const cache = JSON.parse(raw) as CharityCache;
    if (!Array.isArray(cache.items)) return { fresh: false, items: [] };
    const items = cache.items.map(normalizeItem).filter(Boolean) as CharityApiItem[];
    if (!items.length) return { fresh: false, items: [] };
    return {
      fresh: cache.version === CHARITY_CACHE_VERSION && cache.expiresAt > Date.now(),
      items,
    };
  } catch {
    return { fresh: false, items: [] };
  }
}

function writeCachedItems(items: CharityApiItem[]) {
  try {
    const cache: CharityCache = {
      version: CHARITY_CACHE_VERSION,
      expiresAt: Date.now() + CHARITY_CACHE_TTL,
      savedAt: Date.now(),
      items,
    };
    localStorage.setItem(CHARITY_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage failures should not block rendering fresh data for this session.
  }
}

function isRefreshCoolingDown() {
  try {
    const cooldownUntil = Number(localStorage.getItem(CHARITY_REFRESH_COOLDOWN_KEY) || 0);
    return Number.isFinite(cooldownUntil) && cooldownUntil > Date.now();
  } catch {
    return false;
  }
}

function rememberRefreshFailure() {
  try {
    localStorage.setItem(CHARITY_REFRESH_COOLDOWN_KEY, String(Date.now() + CHARITY_REFRESH_FAILURE_COOLDOWN_MS));
  } catch {
    // Ignore storage failures; this only limits repeated background fetches.
  }
}

function clearRefreshFailure() {
  try {
    localStorage.removeItem(CHARITY_REFRESH_COOLDOWN_KEY);
  } catch {
    // Cache freshness still protects the API from repeated requests.
  }
}

function isDismissedToday() {
  try {
    const dismissUntil = Number(localStorage.getItem(CHARITY_DISMISS_KEY) || 0);
    return Number.isFinite(dismissUntil) && dismissUntil > Date.now();
  } catch {
    return false;
  }
}

function dismissUntilTomorrow() {
  try {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    localStorage.setItem(CHARITY_DISMISS_KEY, String(tomorrow.getTime()));
  } catch {
    // Dismissal can still work in state for this session.
  }
}

function mergeUniqueItems(primary: CharityApiItem[], fallback: CharityApiItem[] = []) {
  return Array.from(
    new Map([...primary, ...fallback].filter((item) => item.id).map((item) => [item.id, item])).values(),
  );
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

async function fetchCharityItem(signal: AbortSignal) {
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(() => timeoutController.abort(), CHARITY_FETCH_TIMEOUT_MS);
  const abortRequest = () => timeoutController.abort();
  signal.addEventListener('abort', abortRequest, { once: true });

  try {
    const response = await fetch(CHARITY_API_URL, {
      method: 'GET',
      signal: timeoutController.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Charity API failed: ${response.status}`);
    const payload = await response.json() as CharityApiResponse;
    if (!payload.success) throw new Error('Charity API returned an unsuccessful response');
    return normalizeItem(payload.data);
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abortRequest);
  }
}

async function fetchCharityItems(signal: AbortSignal, fallbackItems: CharityApiItem[]): Promise<FetchCharityItemsResult> {
  const freshItems: CharityApiItem[] = [];
  let consecutiveFailures = 0;

  for (let attempt = 0; attempt < CHARITY_MAX_FETCH_ATTEMPTS; attempt += 1) {
    if (signal.aborted || freshItems.length >= CHARITY_ITEM_COUNT) break;

    let item: CharityApiItem | null = null;
    try {
      item = await fetchCharityItem(signal);
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures += 1;
      if (signal.aborted || consecutiveFailures >= CHARITY_MAX_CONSECUTIVE_FETCH_FAILURES) break;
    }

    if (item && !freshItems.some((current) => current.id === item.id)) {
      freshItems.push(item);
    }
    if (attempt < CHARITY_MAX_FETCH_ATTEMPTS - 1 && freshItems.length < CHARITY_ITEM_COUNT) {
      await wait(CHARITY_FETCH_PAUSE_MS, signal).catch(() => undefined);
    }
  }

  return {
    items: mergeUniqueItems(freshItems, fallbackItems).slice(0, CHARITY_ITEM_COUNT),
    freshItemCount: freshItems.length,
  };
}

export default function CharityAdWidget({ hidden = false }: CharityAdWidgetProps) {
  const [initialCache] = useState(() => readCachedItems());
  const [dismissed, setDismissed] = useState(() => isDismissedToday());
  const [items, setItems] = useState<CharityApiItem[]>(() => initialCache.items);
  const [cacheFresh, setCacheFresh] = useState(() => initialCache.fresh);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(() => new Set());
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
  const widgetRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const fetchStartedRef = useRef(false);

  useEffect(() => {
    if (dismissed || hidden) return;
    if (fetchStartedRef.current) return;
    if (cacheFresh && items.length >= CHARITY_ITEM_COUNT) return;
    if (isRefreshCoolingDown()) return;

    const controller = new AbortController();
    let completed = false;
    fetchStartedRef.current = true;

    fetchCharityItems(controller.signal, items).then((result) => {
      if (controller.signal.aborted) return;
      completed = true;
      if (!result.items.length) {
        rememberRefreshFailure();
        return;
      }

      setItems(result.items);
      if (!result.freshItemCount) {
        rememberRefreshFailure();
        return;
      }

      setCacheFresh(true);
      clearRefreshFailure();
      writeCachedItems(result.items);
    }).catch(() => {
      if (controller.signal.aborted) return;
      completed = true;
      rememberRefreshFailure();
    });

    return () => {
      if (!completed) fetchStartedRef.current = false;
      controller.abort();
    };
  }, [cacheFresh, dismissed, hidden, items]);

  const visibleItems = useMemo(() => items.slice(0, CHARITY_ITEM_COUNT), [items]);
  const activeItem = activeId ? visibleItems.find((item) => item.id === activeId) ?? null : null;
  const activeImageBroken = activeItem?.id ? brokenImageIds.has(activeItem.id) : false;

  const markImageBroken = useCallback((id: string | undefined) => {
    if (!id) return;
    setBrokenImageIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  const cancelCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const scheduleClose = useCallback(() => {
    if (isTouchLikePointer()) return;
    cancelCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setActiveId(null);
      closeTimerRef.current = null;
    }, POPOVER_CLOSE_DELAY);
  }, [cancelCloseTimer]);

  const activateItem = useCallback((id: string | undefined) => {
    cancelCloseTimer();
    setActiveId(id ?? null);
  }, [cancelCloseTimer]);

  useEffect(() => {
    cancelCloseTimer();
    setActiveId(null);
  }, [cancelCloseTimer, hidden]);

  const handleAvatarClick = useCallback((event: MouseEvent<HTMLAnchorElement>, item: CharityApiItem) => {
    if (!isTouchLikePointer()) return;
    event.preventDefault();
    event.stopPropagation();
    cancelCloseTimer();
    setActiveId((current) => current === item.id ? null : item.id ?? null);
  }, [cancelCloseTimer]);

  const updatePopoverPosition = useCallback(() => {
    if (!activeItem || !widgetRef.current || !popoverRef.current) return;

    const widgetRect = widgetRef.current.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    const popoverWidth = Math.min(
      popoverRect.width || 352,
      window.innerWidth - POPOVER_VIEWPORT_PADDING * 2,
    );
    const popoverHeight = Math.min(
      popoverRect.height || 180,
      window.innerHeight - POPOVER_VIEWPORT_PADDING * 2,
    );
    const maxLeft = window.innerWidth - popoverWidth - POPOVER_VIEWPORT_PADDING;
    const left = clamp(widgetRect.right - popoverWidth, POPOVER_VIEWPORT_PADDING, Math.max(POPOVER_VIEWPORT_PADDING, maxLeft));
    const topAbove = widgetRect.top - popoverHeight - POPOVER_GAP;

    let placement: PopoverPosition['placement'] = 'top';
    let top = topAbove;

    if (topAbove < POPOVER_VIEWPORT_PADDING) {
      placement = 'bottom';
      top = widgetRect.bottom + POPOVER_GAP;
    }

    const maxTop = window.innerHeight - popoverHeight - POPOVER_VIEWPORT_PADDING;
    setPopoverPosition({
      left,
      top: clamp(top, POPOVER_VIEWPORT_PADDING, Math.max(POPOVER_VIEWPORT_PADDING, maxTop)),
      placement,
    });
  }, [activeItem]);

  useLayoutEffect(() => {
    if (!activeItem) {
      setPopoverPosition(null);
      return;
    }
    updatePopoverPosition();
  }, [activeItem, updatePopoverPosition]);

  useEffect(() => {
    if (!activeItem) return;

    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [activeItem, updatePopoverPosition]);

  useEffect(() => {
    if (!activeItem) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (widgetRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setActiveId(null);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [activeItem]);

  useEffect(() => () => cancelCloseTimer(), [cancelCloseTimer]);

  if (dismissed || hidden || !visibleItems.length) return null;

  const dismissWidget = () => {
    dismissUntilTomorrow();
    setDismissed(true);
  };

  return (
    <aside
      ref={widgetRef}
      className="charity-ad-widget"
      aria-label="公益广告"
      onMouseEnter={cancelCloseTimer}
      onMouseLeave={scheduleClose}
    >
      <div className="charity-ad-header">
        <div className="charity-ad-title">公益广告</div>
        <button
          type="button"
          className="charity-ad-dismiss"
          onClick={dismissWidget}
          aria-label="今天不再显示公益广告"
          title="今天不再显示"
        >
          x
        </button>
      </div>
      <div className="charity-ad-avatars">
        {visibleItems.map((item, index) => {
          const imageBroken = item.id ? brokenImageIds.has(item.id) : false;
          return (
            <a
              key={item.id}
              className="charity-ad-avatar"
              href={item.url || undefined}
              target={item.url ? '_blank' : undefined}
              rel={item.url ? 'noopener noreferrer' : undefined}
              style={{ zIndex: visibleItems.length - index }}
              onClick={(event) => handleAvatarClick(event, item)}
              onMouseEnter={() => activateItem(item.id)}
              onFocus={() => activateItem(item.id)}
              title={item.name}
            >
              {imageBroken ? (
                <span className="charity-ad-avatar-fallback" aria-hidden="true">
                  {getNameInitial(item)}
                </span>
              ) : (
                <img
                  src={item.child_pic}
                  alt={item.name}
                  loading="lazy"
                  onError={() => markImageBroken(item.id)}
                />
              )}
            </a>
          );
        })}
      </div>

      {activeItem && createPortal(
        <div
          ref={popoverRef}
          className="charity-ad-popover"
          data-placement={popoverPosition?.placement ?? 'top'}
          role="status"
          onMouseEnter={cancelCloseTimer}
          onMouseLeave={scheduleClose}
          style={{
            left: popoverPosition?.left ?? 0,
            top: popoverPosition?.top ?? 0,
            visibility: popoverPosition ? 'visible' : 'hidden',
          }}
        >
          {activeImageBroken ? (
            <div className="charity-ad-popover-image-fallback" aria-hidden="true">
              暂无图片
            </div>
          ) : (
            <img
              className="charity-ad-popover-image"
              src={activeItem.child_pic}
              alt={activeItem.name}
              onError={() => markImageBroken(activeItem.id)}
            />
          )}
          <div className="charity-ad-popover-body">
            <div className="charity-ad-popover-name">寻亲宝贝：{activeItem.name}</div>
            <div className="charity-ad-popover-meta">
              {activeItem.lost_time && (
                <div className="charity-ad-popover-row">
                  <span className="charity-ad-popover-label">走失时间</span>
                  <span className="charity-ad-popover-value">{activeItem.lost_time}</span>
                </div>
              )}
              {activeItem.lost_place && (
                <div className="charity-ad-popover-row">
                  <span className="charity-ad-popover-label">走失地点</span>
                  <span className="charity-ad-popover-value charity-ad-popover-value-clamped" title={activeItem.lost_place}>
                    {activeItem.lost_place}
                  </span>
                </div>
              )}
              {activeItem.child_feature && (
                <div className="charity-ad-popover-row">
                  <span className="charity-ad-popover-label">特征</span>
                  <span className="charity-ad-popover-value charity-ad-popover-value-clamped" title={activeItem.child_feature}>
                    {activeItem.child_feature}
                  </span>
                </div>
              )}
            </div>
            {activeItem.url && (
              <a
                className="charity-ad-popover-link"
                href={activeItem.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                查看详情
              </a>
            )}
          </div>
        </div>,
        document.body,
      )}
    </aside>
  );
}
