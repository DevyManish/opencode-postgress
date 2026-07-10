import { PgClient } from "@effect/sql-pg"
import { Effect, Redacted } from "effect"

// Resolves the Postgres connection string tests should run against. When it is
// unset, database-backed suites are skipped (there is no in-process Postgres),
// so the suite stays green without a server and runs for real once configured.
export const TEST_DATABASE_URL =
  process.env["OPENCODE_TEST_DATABASE_URL"] ?? process.env["OPENCODE_DATABASE_URL"] ?? undefined

export const hasTestDatabase = Boolean(TEST_DATABASE_URL)

// Unlike SQLite `:memory:` (a fresh database per connection), an external
// Postgres persists across the per-test layer rebuilds, so data leaks between
// tests. Truncate every table (except the migration bookkeeping table) so each
// test observes a clean schema, mirroring the old in-memory isolation.
export function resetTestSchema(url = TEST_DATABASE_URL) {
  if (!url) return Promise.resolve()
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient
      const rows = yield* sql<{ tablename: string }>`
        SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename <> 'migration'`
      if (rows.length === 0) return
      const tables = rows.map((row) => `"${row.tablename}"`).join(", ")
      yield* sql.unsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`)
    }).pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(url) })),
      Effect.scoped,
      Effect.orDie,
    ),
  )
}
