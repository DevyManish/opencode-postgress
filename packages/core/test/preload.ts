import path from "path"
import { beforeEach } from "bun:test"
import { resetTestSchema } from "./lib/database"

// Point the process database at the configured test Postgres, if any. Database-backed
// suites skip themselves when no URL is available (see test/lib/database.ts).
if (process.env.OPENCODE_TEST_DATABASE_URL && !process.env.OPENCODE_DATABASE_URL) {
  process.env.OPENCODE_DATABASE_URL = process.env.OPENCODE_TEST_DATABASE_URL
}
process.env.OPENCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"

// The legacy SQLite `:memory:` database was per-connection, so every test rebuilt
// the DB layer against a fresh, empty database. An external Postgres persists across
// those rebuilds, so restore the same per-test isolation by truncating all tables
// (except the migration bookkeeping table) before each test. No-op when no test
// database is configured.
beforeEach(resetTestSchema)
