CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  route_id TEXT NOT NULL,
  route_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  upstream_model TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status INTEGER,
  success INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  request_duration_ms INTEGER NOT NULL DEFAULT 0,
  final_attempt INTEGER NOT NULL DEFAULT 1,
  error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at
  ON ai_usage_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_route_created_at
  ON ai_usage_logs(route_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_key_created_at
  ON ai_usage_logs(key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_request_id
  ON ai_usage_logs(request_id);
