import { disposeAllInstances } from "./fixture"

// Postgres has no on-disk database file to delete between tests; disposing the
// active app instances releases pooled connections. Suites that need a clean
// schema should target an isolated test database via OPENCODE_DATABASE_URL.
export async function resetDatabase() {
  await disposeAllInstances().catch(() => undefined)
}
