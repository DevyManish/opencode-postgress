import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import { testEffect } from "./lib/effect"
import { hasTestDatabase } from "./lib/database"

// The Postgres migration set squashes the historical SQLite migrations into the
// single baseline in `schema.gen.ts`; a fresh database only needs that baseline.
const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node])))

const suite = hasTestDatabase ? describe : describe.skip

suite("DatabaseMigration", () => {
  it.effect("applies the Postgres baseline schema", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db

      const tables = (
        yield* db.execute<{ tablename: string }>(
          sql`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`,
        )
      ).map((row) => row.tablename)
      for (const table of ["session", "session_input", "session_context_epoch", "event", "migration"]) {
        expect(tables).toContain(table)
      }

      const indexes = (
        yield* db.execute<{ indexname: string }>(
          sql`SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname = 'public'`,
        )
      ).map((row) => row.indexname)
      expect(indexes).toContain("event_aggregate_seq_idx")
      expect(indexes).toContain("session_message_session_seq_idx")
    }),
  )

  it.effect("records the tracked migrations in the bookkeeping table", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const [{ count }] = yield* db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM migration`)
      expect(count).toBe(migrations.length)
    }),
  )
})
