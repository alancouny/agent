// Test isolation preload.
//
// Loaded via `node --import ./tests/helpers/preload.mjs` BEFORE the tsx loader and
// before any test file imports `src/db/database.ts`. It redirects every backend test
// process to a private in-memory SQLite database so the test suite never touches the
// real development DB (backend/data/agent.db).
//
// node:test runs each test file in its own process, so `:memory:` gives each file a
// fresh, fully isolated database — no cross-file cleanup or backup/restore needed.
//
// Plain .mjs (not .ts) on purpose: it must run natively before the tsx loader is
// registered, so ordering between --import flags is irrelevant.

process.env.AGENT_DB_PATH = ':memory:';
// 密钥隔离：强制 FileKeyStore，避免测试套件（import server.ts 时 ensureApiKey()
// 会调用 getKeyStore().getOrCreate()）向真实系统钥匙串写入/读取 key。
process.env.AGENT_KEY_STORE = 'file';
