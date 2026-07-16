const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const routeKeyPositions = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request);
    }

    try {
      if (url.pathname === '/auth/status' && request.method === 'GET') {
        return json({ enabled: Boolean(env.ACCESS_PASSWORD) }, request);
      }

      if (url.pathname === '/auth/verify' && request.method === 'POST') {
        return handleAuthVerify(request, env);
      }

      if (url.pathname === '/admin/status' && request.method === 'GET') {
        return json({
          enabled: Boolean(env.ADMIN_PASSWORD),
          analyticsEnabled: Boolean(env.ANALYTICS_DB),
        }, request);
      }

      if (url.pathname === '/admin/auth' && request.method === 'POST') {
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
        return json({ object: 'list', data: listModels(env) }, request);
      }

      if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        const auth = await requireAuth(request, env);
        if (auth) return auth;
        return handleChatCompletions(request, env, ctx);
      }

      return json({ error: { message: 'Not found' } }, request, 404);
    } catch (error) {
      return json({ error: { message: error.message || 'Worker proxy error' } }, request, 500);
    }
  },
};

async function handleAuthVerify(request, env) {
  if (!env.ACCESS_PASSWORD) {
    return json({ token: await createToken(env, false, undefined, 'user'), expiresAt: Date.now() + 12 * 60 * 60 * 1000 }, request);
  }

  const body = await request.json().catch(() => ({}));
  if (body.password !== env.ACCESS_PASSWORD) {
    return json({ error: { message: 'Invalid password' } }, request, 401);
  }

  const rememberMe = Boolean(body.rememberMe);
  const ttlMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  return json({ token: await createToken(env, rememberMe, expiresAt, 'user'), expiresAt }, request);
}

async function handleAdminAuth(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: { message: 'Admin password is not configured.' } }, request, 503);
  }

  const body = await request.json().catch(() => ({}));
  if (body.password !== env.ADMIN_PASSWORD) {
    return json({ error: { message: 'Invalid admin password' } }, request, 401);
  }

  const rememberMe = Boolean(body.rememberMe);
  const ttlMs = rememberMe ? 7 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  return json({ token: await createToken(env, rememberMe, expiresAt, 'admin'), expiresAt }, request);
}

async function handleChatCompletions(request, env, ctx) {
  const body = await request.json();
  const route = findRouteByModel(env, body.model, body.kchat?.routeId);

  if (!route) {
    const routeHint = body.kchat?.routeId ? ` on route ${body.kchat.routeId}` : '';
    return json({ error: { message: `No upstream route configured for model: ${body.model}${routeHint}` } }, request, 400);
  }

  const requestId = crypto.randomUUID();
  const recordAttempt = createAttemptRecorder(env, ctx, {
    requestId,
    route,
    model: body.model,
    upstreamModel: getUpstreamModelName(body.model, route),
  });

  if (route.provider === 'gemini') {
    return proxyGeminiChat(body, route, request, recordAttempt);
  }

  return proxyOpenAIChat(body, route, request, recordAttempt);
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

async function proxyOpenAIChat(body, route, request, recordAttempt) {
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
  }), request);
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

async function proxyGeminiChat(body, route, request, recordAttempt) {
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
    return json({ error: { message } }, request, upstream.status);
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
  }), request);
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
}

async function handleAdminAnalytics(request, env) {
  if (!env.ANALYTICS_DB) {
    return json({ error: { message: 'Analytics database is not configured.' } }, request, 503);
  }

  const url = new URL(request.url);
  const range = normalizeAnalyticsRange(url.searchParams.get('range'));
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 200);
  const since = new Date(Date.now() - range.durationMs).toISOString();
  const bucketExpression = range.hourly
    ? "substr(created_at, 1, 13) || ':00:00Z'"
    : "substr(created_at, 1, 10) || 'T00:00:00Z'";

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
        COUNT(*) AS requests,
        COALESCE(SUM(success), 0) AS successes,
        COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) AS failures
      FROM ai_usage_logs
      WHERE created_at >= ? AND final_attempt = 1
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
    summary: {
      requests,
      attempts: Number(attemptRow.attempts || 0),
      successes,
      failures: Number(summaryRow.failures || 0),
      retries: Number(attemptRow.retries || 0),
      successRate: requests > 0 ? Math.round((successes / requests) * 1000) / 10 : 0,
      avgLatencyMs: Number(summaryRow.avg_latency_ms || 0),
    },
    timeline: timelineResult.results || [],
    channels: channelResult.results || [],
    keys: keyResult.results || [],
    recent: (recentResult.results || []).map((item) => ({
      ...item,
      success: Boolean(item.success),
      finalAttempt: Boolean(item.finalAttempt),
    })),
  }, request);
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
  if (!env.ACCESS_PASSWORD) return null;

  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const valid = token ? await verifyToken(token, env, 'user') : false;

  return valid ? null : json({ error: { message: 'Unauthorized' } }, request, 401);
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: { message: 'Admin password is not configured.' } }, request, 503);
  }

  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const valid = token ? await verifyToken(token, env, 'admin') : false;

  return valid ? null : json({ error: { message: 'Admin authorization required' } }, request, 401);
}

async function createToken(env, rememberMe, expiresAt = Date.now() + 12 * 60 * 60 * 1000, scope = 'user') {
  const payload = base64UrlEncode(JSON.stringify({ exp: expiresAt, rememberMe, scope }));
  const signature = await sign(payload, getTokenSecret(env));
  return `${payload}.${signature}`;
}

async function verifyToken(token, env, expectedScope = 'user') {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = await sign(payload, getTokenSecret(env));
  if (signature !== expected) return false;

  try {
    const data = JSON.parse(base64UrlDecode(payload));
    const scope = data.scope || 'user';
    return typeof data.exp === 'number' && Date.now() < data.exp && scope === expectedScope;
  } catch {
    return false;
  }
}

function getTokenSecret(env) {
  return env.AUTH_SECRET || env.ADMIN_AUTH_SECRET || env.ACCESS_PASSWORD || env.ADMIN_PASSWORD || 'dev-secret';
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

function json(data, request, status = 200) {
  return withCors(new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  }), request);
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin') || '*';
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  headers.set('Vary', 'Origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
