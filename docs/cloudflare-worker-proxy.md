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

Configure the Worker with route data. Each route owns its base URL, API key, and model list. The frontend receives only model metadata and channel names, never API keys. Use `id` as the stable route identifier and optional `name` as the user-facing channel label.

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
  "apiKey": "nvapi-...",
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
npx wrangler secret put AUTH_SECRET --config wrangler.ai-proxy.example.toml
npx wrangler deploy --config wrangler.ai-proxy.example.toml
```

`ACCESS_PASSWORD` enables Worker-side login. `AUTH_SECRET` should be a long random string used to sign browser tokens.

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
