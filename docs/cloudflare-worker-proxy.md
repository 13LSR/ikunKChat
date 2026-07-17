# Cloudflare Worker API Proxy

This project can keep API keys out of the frontend bundle by sending model requests through `workers/ai-proxy.js`.

## Frontend Environment

Set only the public Worker URL in the Cloudflare Pages project and in local `.env`:

```bash
VITE_WORKER_API_BASE_URL="https://ikunkchat-ai-proxy.your-account.workers.dev"
VITE_TITLE_MODEL_NAME="model-a"
```

Do not set `VITE_ACCESS_PASSWORD`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `VITE_API_BASE_URL`, or `VITE_OPENAI_API_BASE_URL` in Cloudflare Pages after switching to the Worker proxy. Values prefixed with `VITE_` are public in browser bundles.

## Worker Secrets

Configure the Worker with route data. Each route owns its base URL, API keys, and model list. The frontend receives only model metadata and channel names, never API keys. Use `id` as the stable route identifier and optional `name` as the user-facing channel label.

Use `apiKeys` when a route has multiple keys. Requests start with the next key in that route's round-robin order. If a request fails because of a network error or returns `401`, `403`, `408`, `429`, or `5xx`, the Worker tries the remaining keys in order. Cloudflare may run multiple Worker isolates, so the rotation is balanced per isolate rather than as one globally strict counter.

The legacy singular `apiKey` field remains supported. If both `apiKeys` and `apiKey` are present, non-empty unique values from both fields participate in rotation.

For readable analytics, each item in `apiKeys` may also be an object with a stable `id` and secret `key`. The dashboard stores only the ID and a masked hint, never the complete key:

```json
"apiKeys": [
  { "id": "nvidia-01", "key": "nvapi-secret-one" },
  { "id": "nvidia-02", "key": "nvapi-secret-two" }
]
```

For OpenAI-compatible APIs, `baseUrl` should be the API origin without `/v1`. If a provider documents `https://api.example.com/v1/chat/completions`, configure `baseUrl` as `https://api.example.com`.

```json
[
  {
    "id": "api-one",
    "name": "Fast Route",
    "provider": "openai",
    "baseUrl": "https://api-one.example.com",
    "apiKey": "sk-...",
    "models": ["model-a", "model-b"]
  },
  {
    "id": "api-two",
    "name": "Backup Route",
    "provider": "openai",
    "baseUrl": "https://api-two.example.com",
    "apiKey": "sk-...",
    "models": ["model-c"]
  }
]
```

Use `provider: "gemini"` for Gemini upstreams. The Worker translates Gemini streaming responses into OpenAI-compatible SSE for the frontend.

Example Gemini route:

```json
{
  "id": "gemini",
  "name": "Gemini",
  "provider": "gemini",
  "baseUrl": "https://generativelanguage.googleapis.com",
  "apiKey": "your-gemini-key",
  "models": ["gemini-2.5-flash", "gemini-2.5-pro"]
}
```

Use `provider: "nvidia"` for NVIDIA NIM routes. NVIDIA is handled as an OpenAI-compatible upstream. You can set `baseUrl` to either `https://integrate.api.nvidia.com` or `https://integrate.api.nvidia.com/v1`; the Worker will normalize the chat completions endpoint.

Example NVIDIA route:

```json
{
  "id": "nvidia",
  "name": "NVIDIA",
  "provider": "nvidia",
  "baseUrl": "https://integrate.api.nvidia.com",
  "apiKeys": [
    { "id": "nvidia-01", "key": "nvapi-key-1" },
    { "id": "nvidia-02", "key": "nvapi-key-2" },
    { "id": "nvidia-03", "key": "nvapi-key-3" }
  ],
  "models": ["gpt-oss-120b"],
  "modelMap": {
    "gpt-oss-120b": "openai/gpt-oss-120b"
  }
}
```

## Commands For You To Run

These commands require Cloudflare credentials, so run them locally after editing values:

```bash
cd workers
npx wrangler secret put AI_ROUTES_JSON --config wrangler.ai-proxy.example.toml
npx wrangler secret put ACCESS_PASSWORD --config wrangler.ai-proxy.example.toml
npx wrangler secret put ADMIN_PASSWORD --config wrangler.ai-proxy.example.toml
npx wrangler secret put AUTH_SECRET --config wrangler.ai-proxy.example.toml
# 可选：为管理员 Token 使用独立签名密钥
npx wrangler secret put ADMIN_AUTH_SECRET --config wrangler.ai-proxy.example.toml
npx wrangler deploy --config wrangler.ai-proxy.example.toml
```

`ACCESS_PASSWORD` enables the public site login. `ADMIN_PASSWORD` protects `/admin` and the analytics API. `AUTH_SECRET` should be a long random string used to sign user browser tokens. `ADMIN_AUTH_SECRET` is optional but recommended when you want administrator tokens to use a separate signing key.

The Worker allows the production origins listed in the project README by default: `https://hjm.331106.xyz`, `https://yx-hjm.331106.xyz`, and `https://eo-hjm.331106.xyz`. For another Pages custom domain, set `CORS_ALLOWED_ORIGINS` to a comma- or newline-separated list of exact origins, for example `https://chat.example.com,https://chat-backup.example.com`, then redeploy the Worker. Do not include paths or trailing slashes.

## Security Boundary

The upstream API keys remain inside the Worker runtime and are never returned to the frontend. The browser can see the public Worker URL, model names, channel names, and its own short-lived user token.

Anyone who knows `ACCESS_PASSWORD` can still obtain a user token and submit requests through the Worker. That is expected for a shared-password public site: the key is hidden, but the upstream quota is being shared. The Worker applies a per-source-IP request limit and only allows configured frontend origins, but this is not a substitute for per-user accounts or durable quota storage.

Use different values for `ACCESS_PASSWORD` and `ADMIN_PASSWORD`. If `AUTH_SECRET` is omitted, user tokens fall back to the user password, while administrator tokens fall back to `ADMIN_AUTH_SECRET`, `AUTH_SECRET`, and then the administrator password. Set `AUTH_SECRET` and preferably `ADMIN_AUTH_SECRET` explicitly in production.

Do not put upstream keys, `ACCESS_PASSWORD`, `ADMIN_PASSWORD`, `AUTH_SECRET`, or any other secret in a `VITE_*` Pages variable. If a secret has ever been placed in a frontend variable or committed file, rotate it at the provider immediately.

## Analytics Database

The admin dashboard uses Cloudflare D1. Create the database, copy the returned ID into `workers/wrangler.ai-proxy.example.toml`, then apply the migration:

```bash
cd workers
npx wrangler d1 create ikunkchat-analytics --config wrangler.ai-proxy.example.toml
npx wrangler d1 migrations apply ikunkchat-analytics --remote --config wrangler.ai-proxy.example.toml
```

The Worker records one row for each upstream Key attempt. It stores the route, provider, model, Key ID, masked Key hint, status, retry/final-attempt state, and latency. Raw API keys and prompts are never stored.

Analytics rows older than 90 days are removed by the Worker Cron Trigger configured in `workers/wrangler.ai-proxy.example.toml`. The default schedule is daily at 03:00 UTC. The cleanup also runs opportunistically after analytics writes, so local development does not require a Cron Trigger.

## Local Verification

Before deploying Pages, verify locally:

```bash
npm install
npm run build
npm run dev:local
```

`npm run dev:local` starts both the local Worker on `http://127.0.0.1:8787` and the Vite app, and points the frontend at that local Worker for the current process.

For Worker-only testing:

```bash
cd workers
cp .dev.vars.example .dev.vars
npx wrangler dev --config wrangler.ai-proxy.example.toml
```

Then set `VITE_WORKER_API_BASE_URL` to the local Wrangler URL and run the app with `npm run dev`.

You can verify the Worker model list before starting the frontend:

```bash
curl http://127.0.0.1:8787/v1/models
```

If `ACCESS_PASSWORD` is enabled, first get a token:

```bash
curl -X POST http://127.0.0.1:8787/auth/verify \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"local-dev-password\",\"rememberMe\":true}"
```

Then call `/v1/models` with `Authorization: Bearer <token>`.
