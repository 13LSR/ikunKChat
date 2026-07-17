const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const routeKeyPositions = new Map();
const rateLimitBuckets = new Map();
let lastRateLimitCleanupAt = 0;
let lastAnalyticsCleanupAt = 0;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const ANALYTICS_RETENTION_DAYS = 90;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hjm.331106.xyz',
  'https://yx-hjm.331106.xyz',
  'https://eo-hjm.331106.xyz',
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (origin && !isAllowedOrigin(origin, env)) {
        return new Response(null, { status: 403 });
      }
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    try {
      const origin = request.headers.get('Origin');
      if (origin && !isAllowedOrigin(origin, env)) {
        return json({ error: { message: 'Origin is not allowed.' } }, request, 403, env);
      }

      if (url.pathname === '/auth/status' && request.method === 'GET') {
        return json({ enabled: Boolean(env.ACCESS_PASSWORD) }, request, 200, env);
      }

      if (url.pathname === '/auth/verify' && request.method === 'POST') {
        const limited = enforceRateLimit(request, env, 'auth');
        if (limited) return limited;
        return handleAuthVerify(request, env);
      }

      if (url.pathname === '/admin/status' && request.method === 'GET') {
        return json({
          enabled: Boolean(env.ADMIN_PASSWORD),
          analyticsEnabled: Boolean(env.ANALYTICS_DB),
        }, request, 200, env);
      }

      if (url.pathname === '/admin/auth' && request.method === 'POST') {
        const limited = enforceRateLimit(request, env, 'admin-auth');
        if (limited) return limited;
        return handleAdminAuth(request, env);
      }

      if (url.pathname === '/admin/analytics' && request.method === 'GET') {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return handleAdminAnalytics(request, env);
      }

      if (url.pathname === '/v1/models' && request.method === 'GET') {
        const auth = await requireAuth(request, env);
        if (auth) return auth;
        const limited = enforceRateLimit(request, env, 'models');
        if (limited) return limited;
        return json({ object: 'list', data: listModels(env) }, request, 200, env);
      }

      if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        const auth = await requireAuth(request, env);
        if (auth) return auth;
        const limited = enforceRateLimit(request, env, 'chat');
        if (limited) return limited;
        return handleChatCompletions(request, env, ctx);
      }

      return json({ error: { message: 'Not found' } }, request, 404, env);
    } catch (error) {
      return json({ error: { message: error.message || 'Worker proxy error' } }, request, 500, env);
    }
  },
  async scheduled(_controller, env, ctx) {
    const cleanup = cleanupAnalytics(env, true);
    if (ctx?.waitUntil) {
      ctx.waitUntil(cleanup);
      return;
    }
    await cleanup;
  },
};

async function handleAuthVerify(request, env) {
  if (!env.ACCESS_PASSWORD) {
    return json({ error: { message: 'Access password is not configured.' } }, request, 503, env);
  }

  const body = await request.json().catch(() => ({}));
  if (body.password !== env.ACCESS_PASSWORD) {
    return json({ error: { message: 'Invalid password' } }, request, 401, env);
  }

  const rememberMe = Boolean(body.rememberMe);
  const ttlMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  return json({ token: await createToken(env, rememberMe, expiresAt, 'user'), expiresAt }, request, 200, env);
}

async function handleAdminAuth(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: { message: 'Admin password is not configured.' } }, request, 503, env);
  }

  const body = await request.json().catch(() => ({}));
  if (body.password !== env.ADMIN_PASSWORD) {
    return json({ error: { message: 'Invalid admin password' } }, request, 401, env);
  }

  const rememberMe = Boolean(body.rememberMe);
  const ttlMs = rememberMe ? 7 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  return json({ token: await createToken(env, rememberMe, expiresAt, 'admin'), expiresAt }, request, 200, env);
}

async function handleChatCompletions(request, env, ctx) {
  const body = await request.json();
  const route = findRouteByModel(env, body.model, body.kchat?.routeId);

  if (!route) {
    const routeHint = body.kchat?.routeId ? ` on route ${body.kchat.routeId}` : '';
    return json({ error: { message: `No upstream route configured for model: ${body.model}${routeHint}` } }, request, 400, env);
  }

  const requestId = crypto.randomUUID();
  const recordAttempt = createAttemptRecorder(env, ctx, {
    requestId,
    route,
    model: body.model,
    upstreamModel: getUpstreamModelName(body.model, route),
  });

  if (route.provider === 'gemini') {
    return proxyGeminiChat(body, route, request, recordAttempt, env);
  }

  return proxyOpenAIChat(body, route, request, recordAttempt, env);
}

function listModels(env) {
  return getRoutes(env).flatMap((route) =>
    route.models.map((id) => ({
      id,
      object: 'model',
      owned_by: route.id || route.provider || 'worker-proxy',
      channel_name: route.name || route.id || route.provider || 'worker-proxy',
    }))
  );
}

function getAnalyticsConfiguration(env) {
  const rawRoutes = getRoutes(env);
  const routeIds = new Map();
  const modelRoutes = new Map();
  const globalWarnings = [];
  const routes = rawRoutes.map((route, index) => {
    const routeId = String(route.id || route.provider || `route-${index + 1}`);
    const routeName = String(route.name || route.id || route.provider || `Route ${index + 1}`);
    const issues = [];

    if (routeIds.has(routeId)) {
      issues.push('routeId 与其他渠道重复');
      globalWarnings.push(`渠道 ${routeName} 的 routeId 与 ${routeIds.get(routeId)} 重复`);
    } else {
      routeIds.set(routeId, routeName);
    }

    if (route.apiKeys.length === 0) {
      issues.push('未配置 API Key');
      globalWarnings.push(`渠道 ${routeName} 未配置 API Key`);
    }

    if (route.models.length === 0) {
      issues.push('未配置模型');
      globalWarnings.push(`渠道 ${routeName} 未配置模型`);
    }

    if (route.provider !== 'gemini' && !route.baseUrl) {
      issues.push('缺少 baseUrl');
      globalWarnings.push(`渠道 ${routeName} 缺少 baseUrl`);
    } else if (route.baseUrl) {
      try {
        const parsedBaseUrl = new URL(route.baseUrl);
        if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
          issues.push('baseUrl 协议异常');
          globalWarnings.push(`渠道 ${routeName} 的 baseUrl 协议异常`);
        }
      } catch {
        issues.push('baseUrl 格式异常');
        globalWarnings.push(`渠道 ${routeName} 的 baseUrl 格式异常`);
      }
    }

    for (const model of route.models) {
      const modelId = String(model);
      const previousRoute = modelRoutes.get(modelId);
      if (previousRoute && previousRoute !== routeName) {
        globalWarnings.push(`模型 ${modelId} 同时配置在 ${previousRoute} 与 ${routeName}`);
      } else {
        modelRoutes.set(modelId, routeName);
      }
    }

    return {
      routeId,
      routeName,
      provider: String(route.provider || 'openai'),
      modelCount: route.models.length,
      models: route.models.map((model) => String(model)),
      keyCount: route.apiKeys.length,
      keys: route.apiKeys.map((apiKey) => ({
        id: apiKey.id,
        hint: apiKey.hint,
      })),
      issues,
    };
  });

  return {
    routeCount: routes.length,
    modelCount: routes.reduce((total, route) => total + route.modelCount, 0),
    keyCount: routes.reduce((total, route) => total + route.keyCount, 0),
    warningCount: globalWarnings.length,
    warnings: [...new Set(globalWarnings)],
    routes,
  };
}

function getRoutes(env) {
  const routes = JSON.parse(env.AI_ROUTES_JSON || '[]');
  if (!Array.isArray(routes)) {
    throw new Error('AI_ROUTES_JSON must be an array.');
  }

  return routes.map((route) => ({
    ...route,
    provider: String(route.provider || 'openai').toLowerCase(),
    name: typeof route.name === 'string' ? route.name : '',
    baseUrl: String(route.baseUrl || '').replace(/\/+$/, ''),
    apiKeys: normalizeApiKeys(route),
    models: Array.isArray(route.models) ? route.models : [],
    modelMap: route.modelMap && typeof route.modelMap === 'object' ? route.modelMap : {},
  }));
}

function normalizeApiKeys(route) {
  const configuredKeys = Array.isArray(route.apiKeys) ? route.apiKeys : [];
  const legacyKeys = Array.isArray(route.apiKey)
    ? route.apiKey
    : typeof route.apiKey === 'string'
      ? [route.apiKey]
      : [];
  const seen = new Set();

  return [...configuredKeys, ...legacyKeys]
    .map((entry, index) => normalizeApiKeyEntry(entry, index))
    .filter((entry) => {
      if (!entry || seen.has(entry.value)) return false;
      seen.add(entry.value);
      return true;
    });
}

function normalizeApiKeyEntry(entry, index) {
  if (typeof entry === 'string') {
    const value = entry.trim();
    if (!value) return null;
    return {
      value,
      id: `key-${String(index + 1).padStart(2, '0')}`,
      hint: maskApiKey(value),
    };
  }

  if (!entry || typeof entry !== 'object') return null;

  const value = String(entry.key || entry.value || entry.apiKey || '').trim();
  if (!value) return null;

  return {
    value,
    id: String(entry.id || entry.name || `key-${String(index + 1).padStart(2, '0')}`).trim(),
    hint: maskApiKey(value),
  };
}

function maskApiKey(value) {
  if (value.length <= 8) return `****${value.slice(-2)}`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function findRouteByModel(env, model, routeId) {
  const routes = getRoutes(env);
  if (routeId) {
    const exactRoute = routes.find((route) => route.id === routeId && route.models.includes(model));
    if (exactRoute) return exactRoute;
  }
  return routes.find((route) => route.models.includes(model));
}

async function proxyOpenAIChat(body, route, request, recordAttempt, env) {
  const endpoint = getOpenAICompatibleChatEndpoint(route);
  const payload = JSON.stringify(prepareOpenAICompatibleBody(body, route));
  const upstream = await fetchWithKeyRotation(route, (apiKey) => fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream, application/json',
      Authorization: `Bearer ${apiKey.value}`,
    },
    body: payload,
  }), recordAttempt);

  return withCors(new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  }), request, env);
}

function getOpenAICompatibleChatEndpoint(route) {
  const baseUrl = route.baseUrl || 'https://api.openai.com';
  if (/\/chat\/completions$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/v1/chat/completions`;
}

function prepareOpenAICompatibleBody(body, route) {
  const payload = {
    ...stripKChatFields(body),
    model: getUpstreamModelName(body.model, route),
  };

  if (route.provider === 'nvidia') {
    return compactObject(payload);
  }

  return payload;
}

function getUpstreamModelName(model, route) {
  if (typeof model !== 'string') return model;
  if (typeof route.modelMap?.[model] === 'string') return route.modelMap[model];

  if (route.provider === 'nvidia' && /^gpt-oss-/i.test(model)) {
    return `openai/${model}`;
  }

  return model;
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value.map(compactObject);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([key, item]) => [key, compactObject(item)])
  );
}

async function proxyGeminiChat(body, route, request, recordAttempt, env) {
  const geminiBody = openAIToGemini(body);
  const endpoint = `${route.baseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(body.model)}:streamGenerateContent?alt=sse`;

  const upstream = await fetchWithKeyRotation(route, (apiKey) => fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey.value,
    },
    body: JSON.stringify(geminiBody),
  }), recordAttempt);

  if (!upstream.ok) {
    const message = await upstream.text();
    return json({ error: { message } }, request, upstream.status, env);
  }

  let buffer = '';
  const stream = upstream.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TransformStream({
      transform(chunk, controller) {
        buffer += chunk;
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          const line = event.split('\n').find((item) => item.startsWith('data: '));
          if (!line) continue;

          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const parsed = JSON.parse(raw);
            const parts = parsed.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (!part.text) continue;
              const deltaKey = part.thought ? 'reasoning_content' : 'content';
              const payload = {
                choices: [{ delta: { [deltaKey]: part.text }, finish_reason: null }],
              };
              controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);
            }
          } catch {
            controller.enqueue(`data: ${raw}\n\n`);
          }
        }
      },
      flush(controller) {
        if (buffer.trim()) {
          const line = buffer.split('\n').find((item) => item.startsWith('data: '));
          const raw = line?.slice(6).trim();
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              const parts = parsed.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                if (!part.text) continue;
                const deltaKey = part.thought ? 'reasoning_content' : 'content';
                const payload = {
                  choices: [{ delta: { [deltaKey]: part.text }, finish_reason: null }],
                };
                controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);
              }
            } catch {
              controller.enqueue(`data: ${raw}\n\n`);
            }
          }
        }
        controller.enqueue('data: [DONE]\n\n');
      },
    }))
    .pipeThrough(new TextEncoderStream());

  return withCors(new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  }), request, env);
}

async function fetchWithKeyRotation(route, requestFactory, recordAttempt) {
  const apiKeys = getRotatedApiKeys(route);
  let lastError;
  let requestDurationMs = 0;

  for (let index = 0; index < apiKeys.length; index += 1) {
    const startedAt = Date.now();
    const apiKey = apiKeys[index];
    const hasAnotherKey = index < apiKeys.length - 1;

    try {
      const response = await requestFactory(apiKey);
      const durationMs = Date.now() - startedAt;
      requestDurationMs += durationMs;
      const willRetry = hasAnotherKey && shouldRetryWithNextKey(response.status);

      notifyAttempt(recordAttempt, {
        apiKey,
        attempt: index + 1,
        status: response.status,
        success: response.ok,
        durationMs,
        requestDurationMs,
        finalAttempt: !willRetry,
        error: response.ok ? '' : response.statusText,
      });

      if (!willRetry) {
        return response;
      }

      await response.body?.cancel().catch(() => {});
    } catch (error) {
      lastError = error;
      const durationMs = Date.now() - startedAt;
      requestDurationMs += durationMs;

      notifyAttempt(recordAttempt, {
        apiKey,
        attempt: index + 1,
        status: null,
        success: false,
        durationMs,
        requestDurationMs,
        finalAttempt: !hasAnotherKey,
        error: error?.message || 'Network error',
      });

      if (!hasAnotherKey) throw error;
    }
  }

  throw lastError || new Error(`All API keys failed for route: ${getRouteLabel(route)}`);
}

function notifyAttempt(recordAttempt, details) {
  if (!recordAttempt) return;

  try {
    recordAttempt(details);
  } catch {
    // Analytics must never interrupt an upstream request.
  }
}

function getRotatedApiKeys(route) {
  if (!route.apiKeys.length) {
    throw new Error(`No API key configured for route: ${getRouteLabel(route)}`);
  }

  const rotationKey = getRouteRotationKey(route);
  const startIndex = (routeKeyPositions.get(rotationKey) || 0) % route.apiKeys.length;
  routeKeyPositions.set(rotationKey, (startIndex + 1) % route.apiKeys.length);

  return route.apiKeys.map((_, offset) => route.apiKeys[(startIndex + offset) % route.apiKeys.length]);
}

function getRouteRotationKey(route) {
  return route.id || `${route.provider}:${route.baseUrl}:${route.models.join(',')}`;
}

function getRouteLabel(route) {
  return route.id || route.name || route.provider || 'unknown';
}

function shouldRetryWithNextKey(status) {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

function enforceRateLimit(request, env, scope) {
  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0].trim()
    || 'unknown-ip';
  const identity = `ip:${ip}`;
  const key = `${scope}:${identity}`;
  const current = rateLimitBuckets.get(key);

  if (!current || now - current.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { windowStartedAt: now, count: 1 });
    cleanupRateLimitBuckets(now);
    return null;
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil(
      (RATE_LIMIT_WINDOW_MS - (now - current.windowStartedAt)) / 1000
    ));
    return json({
      error: {
        message: 'Too many requests. Please try again later.',
        code: 'RATE_LIMITED',
        retryAfterSeconds,
      },
    }, request, 429, env, {
      'Retry-After': String(retryAfterSeconds),
      'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
      'X-RateLimit-Remaining': '0',
    });
  }

  current.count += 1;
  cleanupRateLimitBuckets(now);
  return null;
}

function cleanupRateLimitBuckets(now) {
  if (now - lastRateLimitCleanupAt < RATE_LIMIT_WINDOW_MS) return;
  lastRateLimitCleanupAt = now;
  for (const [key, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(key);
    }
  }
}

function createAttemptRecorder(env, ctx, base) {
  return (details) => {
    const task = recordAnalyticsAttempt(env, base, details).catch(() => {});
    if (ctx?.waitUntil) {
      ctx.waitUntil(task);
    } else {
      void task;
    }
  };
}

async function recordAnalyticsAttempt(env, base, details) {
  if (!env.ANALYTICS_DB) return;

  await env.ANALYTICS_DB.prepare(`
    INSERT INTO ai_usage_logs (
      request_id,
      route_id,
      route_name,
      provider,
      model,
      upstream_model,
      key_id,
      key_hint,
      attempt,
      status,
      success,
      duration_ms,
      request_duration_ms,
      final_attempt,
      error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    base.requestId,
    String(base.route.id || base.route.provider || 'unknown'),
    String(base.route.name || base.route.id || base.route.provider || 'Unknown'),
    String(base.route.provider || 'openai'),
    String(base.model || ''),
    String(base.upstreamModel || base.model || ''),
    details.apiKey.id,
    details.apiKey.hint,
    details.attempt,
    details.status,
    details.success ? 1 : 0,
    details.durationMs,
    details.requestDurationMs,
    details.finalAttempt ? 1 : 0,
    String(details.error || '').slice(0, 500)
  ).run();

  scheduleAnalyticsCleanup(env);
}

function scheduleAnalyticsCleanup(env) {
  void cleanupAnalytics(env);
}

function cleanupAnalytics(env, force = false) {
  if (!env.ANALYTICS_DB) return Promise.resolve();
  const now = Date.now();
  if (!force && now - lastAnalyticsCleanupAt < 60 * 60 * 1000) {
    return Promise.resolve();
  }
  lastAnalyticsCleanupAt = now;

  return env.ANALYTICS_DB.prepare(`
    DELETE FROM ai_usage_logs
    WHERE created_at < datetime('now', ?)
  `).bind(`-${ANALYTICS_RETENTION_DAYS} days`).run().catch(() => {});
}

function isMissingAnalyticsTableError(error) {
  return /no such table:\s*ai_usage_logs/i.test(String(error?.message || error || ''));
}

async function handleAdminAnalytics(request, env) {
  if (!env.ANALYTICS_DB) {
    return json({ error: { message: 'Analytics database is not configured.' } }, request, 503, env);
  }

  const url = new URL(request.url);
  const range = normalizeAnalyticsRange(url.searchParams.get('range'));
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 200);
  const since = new Date(Date.now() - range.durationMs).toISOString();
  const bucketExpression = range.hourly
    ? "substr(created_at, 1, 13) || ':00:00Z'"
    : "substr(created_at, 1, 10) || 'T00:00:00Z'";

  try {
    const [summaryResult, attemptResult, timelineResult, channelResult, keyResult, recentResult] = await env.ANALYTICS_DB.batch([
      env.ANALYTICS_DB.prepare(`
      SELECT
        COUNT(*) AS requests,
        COALESCE(SUM(success), 0) AS successes,
        COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) AS failures,
        COALESCE(ROUND(AVG(request_duration_ms)), 0) AS avg_latency_ms
      FROM ai_usage_logs
      WHERE created_at >= ? AND final_attempt = 1
      `).bind(since),
      env.ANALYTICS_DB.prepare(`
      SELECT
        COUNT(*) AS attempts,
        COALESCE(SUM(CASE WHEN final_attempt = 0 THEN 1 ELSE 0 END), 0) AS retries
      FROM ai_usage_logs
      WHERE created_at >= ?
      `).bind(since),
      env.ANALYTICS_DB.prepare(`
      SELECT
        ${bucketExpression} AS bucket,
        COALESCE(SUM(CASE WHEN final_attempt = 1 THEN 1 ELSE 0 END), 0) AS requests,
        COALESCE(SUM(CASE WHEN final_attempt = 1 AND success = 1 THEN 1 ELSE 0 END), 0) AS successes,
        COALESCE(SUM(CASE WHEN final_attempt = 1 AND success = 0 THEN 1 ELSE 0 END), 0) AS failures,
      COALESCE(SUM(CASE WHEN final_attempt = 0 THEN 1 ELSE 0 END), 0) AS retries,
      COUNT(*) AS attempts
      FROM ai_usage_logs
      WHERE created_at >= ?
      GROUP BY bucket
      ORDER BY bucket ASC
      `).bind(since),
      env.ANALYTICS_DB.prepare(`
      SELECT
        route_id AS routeId,
        route_name AS routeName,
        provider,
        COUNT(*) AS requests,
        COALESCE(SUM(success), 0) AS successes,
        COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) AS failures,
        COALESCE(ROUND(AVG(request_duration_ms)), 0) AS avgLatencyMs
      FROM ai_usage_logs
      WHERE created_at >= ? AND final_attempt = 1
      GROUP BY route_id, route_name, provider
      ORDER BY requests DESC
      `).bind(since),
      env.ANALYTICS_DB.prepare(`
      SELECT
        route_id AS routeId,
        route_name AS routeName,
        key_id AS keyId,
        key_hint AS keyHint,
        COUNT(*) AS attempts,
        COALESCE(SUM(success), 0) AS successes,
        COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) AS failures,
        MAX(created_at) AS lastUsedAt
      FROM ai_usage_logs
      WHERE created_at >= ?
      GROUP BY route_id, route_name, key_id, key_hint
      ORDER BY attempts DESC, route_name ASC, key_id ASC
      `).bind(since),
      env.ANALYTICS_DB.prepare(`
      SELECT
        id,
        request_id AS requestId,
        created_at AS createdAt,
        route_id AS routeId,
        route_name AS routeName,
        provider,
        model,
        upstream_model AS upstreamModel,
        key_id AS keyId,
        key_hint AS keyHint,
        attempt,
        status,
        success,
        duration_ms AS durationMs,
        request_duration_ms AS requestDurationMs,
        final_attempt AS finalAttempt,
        error
      FROM ai_usage_logs
      WHERE created_at >= ?
      ORDER BY id DESC
      LIMIT ?
      `).bind(since, limit),
    ]);

    const summaryRow = summaryResult.results?.[0] || {};
    const attemptRow = attemptResult.results?.[0] || {};
    const requests = Number(summaryRow.requests || 0);
    const successes = Number(summaryRow.successes || 0);

    return json({
      range: range.id,
      generatedAt: new Date().toISOString(),
      configuration: getAnalyticsConfiguration(env),
      summary: {
        requests,
        attempts: Number(attemptRow.attempts || 0),
        successes,
        failures: Number(summaryRow.failures || 0),
        retries: Number(attemptRow.retries || 0),
        successRate: requests > 0 ? Math.round((successes / requests) * 1000) / 10 : 0,
        avgLatencyMs: Number(summaryRow.avg_latency_ms || 0),
      },
      timeline: (timelineResult.results || []).map((item) => {
        const requestsInBucket = Number(item.requests || 0);
        const attemptsInBucket = Number(item.attempts || 0);
        const failuresInBucket = Number(item.failures || 0);
        const retriesInBucket = Number(item.retries || 0);
        return {
          ...item,
          requests: requestsInBucket,
          successes: Number(item.successes || 0),
          failures: failuresInBucket,
          retries: retriesInBucket,
          attempts: attemptsInBucket,
          failureRate: requestsInBucket > 0
            ? Math.round((failuresInBucket / requestsInBucket) * 1000) / 10
            : 0,
          retryRate: attemptsInBucket > 0
            ? Math.round((retriesInBucket / attemptsInBucket) * 1000) / 10
            : 0,
        };
      }),
      channels: channelResult.results || [],
      keys: keyResult.results || [],
      recent: (recentResult.results || []).map((item) => ({
        ...item,
        success: Boolean(item.success),
        finalAttempt: Boolean(item.finalAttempt),
      })),
    }, request, 200, env);
  } catch (error) {
    if (isMissingAnalyticsTableError(error)) {
      return json({
        range: range.id,
        generatedAt: new Date().toISOString(),
        configuration: getAnalyticsConfiguration(env),
        summary: {
          requests: 0,
          attempts: 0,
          successes: 0,
          failures: 0,
          retries: 0,
          successRate: 0,
          avgLatencyMs: 0,
        },
        timeline: [],
        channels: [],
        keys: [],
        recent: [],
        warning: 'Analytics table is not migrated yet.',
      }, request, 200, env);
    }
    throw error;
  }
}

function normalizeAnalyticsRange(value) {
  const ranges = {
    '24h': { id: '24h', durationMs: 24 * 60 * 60 * 1000, hourly: true },
    '7d': { id: '7d', durationMs: 7 * 24 * 60 * 60 * 1000, hourly: true },
    '30d': { id: '30d', durationMs: 30 * 24 * 60 * 60 * 1000, hourly: false },
    '90d': { id: '90d', durationMs: 90 * 24 * 60 * 60 * 1000, hourly: false },
  };

  return ranges[value] || ranges['24h'];
}

function openAIToGemini(body) {
  const systemParts = [];
  const contents = [];

  for (const message of body.messages || []) {
    if (message.role === 'system') {
      systemParts.push(contentToText(message.content));
      continue;
    }

    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: contentToGeminiParts(message.content),
    });
  }

  const generationConfig = {
    temperature: body.temperature,
    maxOutputTokens: body.max_tokens,
  };

  const result = {
    contents,
    generationConfig,
  };

  if (systemParts.length > 0) {
    result.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
  }

  if (body.kchat?.showThoughts) {
    result.generationConfig.thinkingConfig = { includeThoughts: true };
  }

  if (body.kchat?.enableSearch) {
    result.tools = [{ googleSearch: {} }];
  }

  return result;
}

function contentToGeminiParts(content) {
  if (typeof content === 'string') {
    return content ? [{ text: content }] : [];
  }

  if (!Array.isArray(content)) return [];

  return content.flatMap((part) => {
    if (part.type === 'text' && part.text) {
      return [{ text: part.text }];
    }

    if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:')) {
      const match = part.image_url.url.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) return [];
      return [{ inlineData: { mimeType: match[1], data: match[2] } }];
    }

    return [];
  });
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => part.text || '').filter(Boolean).join('\n');
}

function stripKChatFields(body) {
  const { kchat, ...rest } = body;
  return rest;
}

async function requireAuth(request, env) {
  if (!env.ACCESS_PASSWORD) {
    return json({ error: { message: 'Access password is not configured.' } }, request, 503, env);
  }

  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const valid = token ? await verifyToken(token, env, 'user') : false;

  return valid ? null : json({ error: { message: 'Unauthorized' } }, request, 401, env);
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: { message: 'Admin password is not configured.' } }, request, 503, env);
  }

  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const valid = token ? await verifyToken(token, env, 'admin') : false;

  return valid ? null : json({ error: { message: 'Admin authorization required' } }, request, 401, env);
}

async function createToken(env, rememberMe, expiresAt = Date.now() + 12 * 60 * 60 * 1000, scope = 'user') {
  const payload = base64UrlEncode(JSON.stringify({ exp: expiresAt, rememberMe, scope }));
  const signature = await sign(payload, getTokenSecret(env, scope));
  return `${payload}.${signature}`;
}

async function verifyToken(token, env, expectedScope = 'user') {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = await sign(payload, getTokenSecret(env, expectedScope));
  if (signature !== expected) return false;

  try {
    const data = JSON.parse(base64UrlDecode(payload));
    const scope = data.scope || 'user';
    return typeof data.exp === 'number' && Date.now() < data.exp && scope === expectedScope;
  } catch {
    return false;
  }
}

function getTokenSecret(env, scope = 'user') {
  if (scope === 'admin') {
    return env.ADMIN_AUTH_SECRET || env.AUTH_SECRET || env.ADMIN_PASSWORD || env.ACCESS_PASSWORD || 'dev-secret';
  }

  return env.AUTH_SECRET || env.ACCESS_PASSWORD || env.ADMIN_AUTH_SECRET || env.ADMIN_PASSWORD || 'dev-secret';
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
}

function base64UrlEncode(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(padded);
}

function json(data, request, status = 200, env = {}, extraHeaders = {}) {
  return withCors(new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  }), request, env);
}

function getAllowedOrigins(env) {
  const configured = String(env.CORS_ALLOWED_ORIGINS || '')
    .split(/[,\n]/)
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    ...configured,
  ]);
}

function isAllowedOrigin(origin, env) {
  return getAllowedOrigins(env).has(origin);
}

function withCors(response, request, env = {}) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin');
  if (origin && isAllowedOrigin(origin, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  headers.set('Vary', 'Origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
