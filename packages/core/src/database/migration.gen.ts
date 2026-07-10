import type { DatabaseMigration } from "./migration"

// Postgres installs start from the squashed baseline in `schema.gen.ts`. The
// 38 historical SQLite incremental migrations are SQLite-specific (PRAGMA,
// table-rebuild, json_extract, GLOB, ...) and are intentionally not ported.
export const migrations: DatabaseMigration.Migration[] = []
