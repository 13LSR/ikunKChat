const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
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

      if (url.pathname === '/v1/models' && request.method === 'GET') {
        const auth = await requireAuth(request, env);
        if (auth) return auth;
        return json({ object: 'list', data: listModels(env) }, request);
      }

      if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        const auth = await requireAuth(request, env);
        if (auth) return auth;
        return handleChatCompletions(request, env);
      }

      return json({ error: { message: 'Not found' } }, request, 404);
    } catch (error) {
      return json({ error: { message: error.message || 'Worker proxy error' } }, request, 500);
    }
  },
};

async function handleAuthVerify(request, env) {
  if (!env.ACCESS_PASSWORD) {
    return json({ token: await createToken(env, false), expiresAt: Date.now() + 12 * 60 * 60 * 1000 }, request);
  }

  const body = await request.json().catch(() => ({}));
  if (body.password !== env.ACCESS_PASSWORD) {
    return json({ error: { message: 'Invalid password' } }, request, 401);
  }

  const rememberMe = Boolean(body.rememberMe);
  const ttlMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  return json({ token: await createToken(env, rememberMe, expiresAt), expiresAt }, request);
}

async function handleChatCompletions(request, env) {
  const body = await request.json();
  const route = findRouteByModel(env, body.model);

  if (!route) {
    return json({ error: { message: `No upstream route configured for model: ${body.model}` } }, request, 400);
  }

  if (route.provider === 'gemini') {
    return proxyGeminiChat(body, route, request);
  }

  return proxyOpenAIChat(body, route, request);
}

function listModels(env) {
  return getRoutes(env).flatMap((route) =>
    route.models.map((id) => ({
      id,
      object: 'model',
      owned_by: route.id || route.provider || 'worker-proxy',
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
    provider: route.provider || 'openai',
    baseUrl: String(route.baseUrl || '').replace(/\/$/, ''),
    models: Array.isArray(route.models) ? route.models : [],
  }));
}

function findRouteByModel(env, model) {
  return getRoutes(env).find((route) => route.models.includes(model));
}

async function proxyOpenAIChat(body, route, request) {
  const upstream = await fetch(`${route.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${route.apiKey}`,
    },
    body: JSON.stringify(stripKChatFields(body)),
  });

  return withCors(new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  }), request);
}

async function proxyGeminiChat(body, route, request) {
  const geminiBody = openAIToGemini(body);
  const endpoint = `${route.baseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(body.model)}:streamGenerateContent?alt=sse`;

  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': route.apiKey,
    },
    body: JSON.stringify(geminiBody),
  });

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
  const valid = token ? await verifyToken(token, env) : false;

  return valid ? null : json({ error: { message: 'Unauthorized' } }, request, 401);
}

async function createToken(env, rememberMe, expiresAt = Date.now() + 12 * 60 * 60 * 1000) {
  const payload = base64UrlEncode(JSON.stringify({ exp: expiresAt, rememberMe }));
  const signature = await sign(payload, env.AUTH_SECRET || env.ACCESS_PASSWORD || 'dev-secret');
  return `${payload}.${signature}`;
}

async function verifyToken(token, env) {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = await sign(payload, env.AUTH_SECRET || env.ACCESS_PASSWORD || 'dev-secret');
  if (signature !== expected) return false;

  const data = JSON.parse(base64UrlDecode(payload));
  return typeof data.exp === 'number' && Date.now() < data.exp;
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
