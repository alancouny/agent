// R2：global_memories 双 FTS5 external content 索引。
// - global_memories_fts          (unicode61)  → 英文词 / 标签预筛
// - global_memories_fts_trigram   (trigram)   → 中文 ≥3 字符子串预筛
// 触发器自动同步增删改（写路径无需业务双写）。external content 删除必须走
// 'delete' 特殊命令（否则 orphan）；注意 FTS5 没有 'insert' 特殊命令，
// 因此 UPDATE 同步 = 'delete' 旧值 + 普通 INSERT 新值。
// （设计文档 §3.1 的 VALUES('insert', …) 无法在 SQLite 3.53.4 执行，已修正。）
export const FTS_SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS global_memories_fts USING fts5(
  content,
  tags,
  content='global_memories',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS global_memories_fts_trigram USING fts5(
  content,
  content='global_memories',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS trg_mem_fts_insert AFTER INSERT ON global_memories BEGIN
  INSERT INTO global_memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
  INSERT INTO global_memories_fts_trigram(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS trg_mem_fts_delete AFTER DELETE ON global_memories BEGIN
  INSERT INTO global_memories_fts(global_memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
  INSERT INTO global_memories_fts_trigram(global_memories_fts_trigram, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS trg_mem_fts_update AFTER UPDATE ON global_memories BEGIN
  INSERT INTO global_memories_fts(global_memories_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, old.tags);
  INSERT INTO global_memories_fts(rowid, content, tags) VALUES(new.rowid, new.content, new.tags);
  INSERT INTO global_memories_fts_trigram(global_memories_fts_trigram, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO global_memories_fts_trigram(rowid, content) VALUES(new.rowid, new.content);
END;
`;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cost_estimates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  model TEXT,
  predicted_tool_calls INTEGER,
  predicted_tokens INTEGER,
  actual_tool_calls INTEGER,
  actual_tokens INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS global_memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT,
  source TEXT DEFAULT 'local',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT 'New Session',
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  summary TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')),
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_call_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  category TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  input TEXT,
  output TEXT,
  permission TEXT CHECK(permission IN ('allow','approve','deny')),
  duration_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 应用级键值设置（R4 决策 E）：JSON 序列化 value，统一经 db/settings.ts 的 settingsStore 读写。
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  type TEXT CHECK(type IN ('episodic','semantic','procedural')),
  content TEXT NOT NULL,
  summary TEXT,
  importance REAL DEFAULT 0.5,
  created_at TEXT DEFAULT (datetime('now')),
  accessed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','planning','running','paused','completed','failed')),
  progress INTEGER DEFAULT 0,
  current_step INTEGER DEFAULT 0,
  total_steps INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
  "order" INTEGER NOT NULL,
  output TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);

CREATE TABLE IF NOT EXISTS usage_log (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  model TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_log(session_id);

-- DeepSeek-Harness-style Session Log: append-only event stream.
-- This is the authoritative record of everything the model saw —
-- UI, replay, resume and telemetry all derive from it.
CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  turn_idx INTEGER DEFAULT 0,
  step_idx INTEGER DEFAULT 0,
  type TEXT NOT NULL,
  role TEXT,
  content TEXT,
  tool_name TEXT,
  args TEXT,
  result TEXT,
  model TEXT,
  tokens TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_seq ON session_events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(session_id, type);

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT,
  chunk_count INTEGER DEFAULT 0,
  raw_text TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,
  embedding_version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_knowledge_doc ON knowledge_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_ver ON knowledge_chunks(embedding_version);

CREATE TABLE IF NOT EXISTS rag_config (
  id TEXT PRIMARY KEY,
  embedding_model TEXT,
  embedding_base_url TEXT,
  embedding_api_key TEXT,
  chunk_size INTEGER DEFAULT 900,
  chunk_overlap INTEGER DEFAULT 120,
  chunk_strategy TEXT DEFAULT 'paragraph',
  retrieval_mode TEXT DEFAULT 'dense',
  rerank_enabled INTEGER DEFAULT 0,
  top_k INTEGER DEFAULT 5,
  score_threshold REAL DEFAULT 0.2,
  index_backend TEXT DEFAULT 'bruteforce',
  embedding_version INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
` + FTS_SCHEMA_SQL;