# opencode: SQLite → Postgres migration plan

## Implementation status (IMPLEMENTED & VERIFIED)

Phases 0–6 and 8 are **implemented and verified against a real Postgres server**.
Phase 7 (one-time SQLite→pg ETL for existing installs) is intentionally
**deferred** — the old sqlite packages remain on disk (nothing imports them) so
an ETL read-path can be added later without reverting anything.

**What was built**
- Deps/catalog: added `@effect/sql-pg@4.0.0-beta.83`; new workspace package
  `@opencode-ai/effect-drizzle-pg` (thin re-export of upstream `drizzle-orm`
  Effect-pg bindings + a `.all/.run/.get` compat shim so the runner/CLI keep
  working). `@opencode-ai/core` now depends on it.
- All 11 schema files converted `sqlite-core` → `pg-core` per the §3 type map
  (`bigint({mode:"number"})` for timestamps/seqs/counters, `boolean`,
  `doublePrecision`, `jsonb`, `pg-core` customType import in `path.ts`).
- Driver/runtime rewritten: single `PgClient.layer({url: Redacted.make(url)})`
  serves both node & bun; `#sqlite` conditional import and PRAGMAs removed;
  `database.ts` resolves the connection via the §1a order (`OPENCODE_DATABASE_URL`
  → `OPENCODE_DB` if URL → JSON `database.url` → `PG*` env → local default).
- Migration runner + baseline DDL rewritten to Postgres (`schema.gen.ts` squashed
  pg DDL; `sqlite_master`→`pg_catalog.pg_tables`; `INSERT OR IGNORE`→`ON CONFLICT
  DO NOTHING`; `migration.gen.ts` empty incremental set for pg).
- Tooling: `drizzle.config.ts` → `dialect: "postgresql"`; `cmd/db.ts` → `psql`.

**Verification (real Postgres, Docker)**
- Server: Docker container `opencode-pg` (`postgres:16-alpine`), host port
  **5433**→5432, user `testuser`, password `test123`, databases `opencode` and
  `opencode_target`.
- Typecheck clean across all DB-consuming packages: `core`, `opencode`,
  `sdk-next`, `effect-drizzle-pg`, `server`.
- `packages/core` full suite: **1033 pass / 23 fail**. All 23 failures are
  pre-existing **environmental** timeouts on this Windows checkout (Git,
  MoveSession, Npm, ProjectCopy, RepositoryCache, Snapshot, cross-spawn, Git Bash
  shell-path) — subprocess/git/fs, unrelated to the DB migration. **Zero
  DB-correctness failures remain.** (`desktop` typecheck fails only on a
  pre-existing broken git symlink, also unrelated.)

**Test env vars**
- `OPENCODE_DATABASE_URL=postgres://testuser:test123@localhost:5433/opencode`
- `OPENCODE_TEST_TARGET_DATABASE_URL=postgres://testuser:test123@localhost:5433/opencode_target`

**Async-vs-sync test adaptations** (SQLite ops were synchronous; async pg I/O
exposed latent per-test assumptions):
- **Per-test isolation:** old `OPENCODE_DB=:memory:` gave every test a fresh DB
  (per connection). Postgres persists, so a global `beforeEach(resetTestSchema)`
  was added in `test/preload.ts`. `resetTestSchema(url?)` (in `test/lib/database.ts`)
  TRUNCATEs all public tables except `migration` via its own `@effect/sql-pg`
  `PgClient` layer (the `pg` package isn't directly resolvable from core).
- **Clock:** clock-sensitive interruption tests switched `it.effect`→`it.live`
  (TestClock does not advance while real async pg I/O is pending).
- **Advisory-wake timing:** `SessionExecution.wake` forks a drain fiber and
  returns; SQLite's synchronous drain completed inline, async pg suspends. Tests
  now poll `while (requests.length < N) yield* Effect.yieldNow` before asserting.

**Concurrency idempotency fix** (`src/session/input.ts` `publish`): under real
Postgres concurrency two `promoteSteers` callers can both read the same
unpromoted `session_input` row; the loser's durable Prompted transaction rolls
back (its duplicate `session_message` insert fails during projection, before any
event row is written) and surfaces a defect. Broadened the existing
`Effect.catchDefect` so that on **any** defect it re-checks `find(db, id)`: if the
input is already promoted (`promotedSeq` set) it is a no-op, otherwise the defect
is re-raised. Result: exactly one event / one message / `promoted_seq=1` under
concurrent promotion — verified by
`SessionV2.prompt > promotes one message once under concurrent promotion attempts`.

---

## 0. Executive summary

opencode's primary datastore is a **local SQLite file** accessed through a
custom **Effect + Drizzle** stack. The DB lives in `packages/core/src/database`
and is consumed by `packages/core`, `packages/opencode`, and `packages/server`
through a single `Database.Service` whose `.db` is a Drizzle client built by the
vendored `@opencode-ai/effect-drizzle-sqlite` package.

Good news: **almost all call sites use the dialect‑agnostic Drizzle query
builder** (`db.insert().values().onConflictDoUpdate()`, `db.select()`,
`db.transaction()`). Those APIs exist identically in Drizzle `pg-core`, so the
bulk of the code does not change. The work concentrates in five well‑bounded
areas:

1. Schema definitions (`*sql.ts`) — swap `sqlite-core` → `pg-core`, fix column types.
2. The vendored Effect‑Drizzle adapter — add a Postgres twin of `effect-drizzle-sqlite`.
3. The driver/runtime layer (`sqlite.node.ts` / `sqlite.bun.ts` / `#sqlite`) — replace with a Postgres `SqlClient`.
4. The migration runner + baseline DDL (`migration.ts`, `schema.gen.ts`, `migration/*`).
5. Tooling, tests, data migration for existing installs.

The two most important scoping facts:

- **`schema.gen.ts` is the squashed current schema.** When the DB is empty the
  runner applies `schema.gen.ts` and marks all 38 incremental migrations as
  already done. A fresh Postgres DB is always empty, so **we only port ONE
  schema file to Postgres DDL** — the 38 historical SQLite migration files are
  irrelevant to Postgres and are excluded from the Postgres migration set.
- **Existing users' data lives in SQLite.** Switching engines means either a
  fresh start or a **one‑time ETL** from the old SQLite file into Postgres
  (covered in §7).

---

## 1. Target: External Postgres server, swappable via config (DECIDED)

opencode connects to an **external Postgres server** whose connection string is
supplied by configuration, so the instance can be pointed at localhost, Docker,
or a managed cloud Postgres by changing one value.

- **Driver:** `@effect/sql-pg` `PgClient.layer({ url: Redacted.make(url) })`
  (wraps the `pg` driver stack; works under both node and bun).
- **Connection source (swap mechanism):** a resolved Postgres connection config
  at startup — see **§1a**.
- PGlite is **not** used at runtime; it is kept **only** as an optional in‑process
  Postgres for tests (no server needed in CI). If you'd rather tests hit a real
  Postgres (Docker/testcontainer), PGlite can be dropped entirely.

The rest of the plan (adapter, schema, runner, ETL) is identical regardless of
which Postgres server you point at.

**Operational prerequisite:** the target Postgres database and role should
already exist. opencode should create/update tables inside that database, not
create the database itself. The connection config should support SSL and pool
options (`ssl`, `maxConnections`, `idleTimeout`) for managed Postgres providers.

---

## 1a. Configuration & connection swapping

**Constraint that drives the design:** `Database.node` is built at *module load*
via `layerFromPath(path())`, and `path()` reads `Flag.OPENCODE_DB` from `env`.
The opencode JSON config (`ConfigV1.Info`) is loaded *later/asynchronously*, so
the connection string must be resolvable synchronously at layer‑construction
time. Therefore the primary, always‑available knob is an **environment
variable**, mirroring the existing `OPENCODE_DB` pattern.

**Resolution order (first match wins; JSON config requires the refactor below):**
1. `OPENCODE_DATABASE_URL` env var — e.g. `postgres://opencode@localhost:5432/opencode`.
2. `OPENCODE_DB` env var if it looks like a URL (`postgres://` / `postgresql://`) —
   keeps the existing flag name working as an alias.
3. JSON config `database.url` from `opencode.json` / `opencode.jsonc`.
4. Individual `PG*` env vars (`PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`) —
   the underlying `pg` driver reads these natively; lets ops use standard Postgres env.
5. Fallback default for local dev: `postgres://postgres@127.0.0.1:5432/opencode`.

**New flag** in `flag/flag.ts`:
```ts
OPENCODE_DATABASE_URL: process.env["OPENCODE_DATABASE_URL"],
```

**JSON config support.** To allow `~/.config/opencode/opencode.json` or
project config to set `{ "database": { "url": "postgres://…" } }`, add a
`database` config module under `packages/core/src/config/database.ts` and wire it
into `packages/core/src/config.ts` and `packages/core/src/v1/config/config.ts`.
Shape:
```ts
database: {
  url?: string
  ssl?: boolean
  maxConnections?: number
  idleTimeout?: number
}
```
Follow the repo convention by self-exporting at the top of the new module
(`export * as ConfigDatabase from "./database"`).
Because the current DB layer is global and constructed from env at module load,
JSON config requires a small refactor: either make `Database.node` location-scoped
and depend on `Config.node`, or split out a synchronous/global database config
loader that runs before the DB layer is built. The plan should implement this if
"config" means opencode JSON config; env-var swapping works immediately and
remains the highest-priority override.

**Result:** swapping databases = set/change `OPENCODE_DATABASE_URL` or
`opencode.json` `database.url` once the config refactor lands. No code changes.

---

## 2. Inventory of SQLite touch points (what changes)

### 2a. Schema definitions (`drizzle-orm/sqlite-core`) — 11 files
`account/sql.ts`, `credential/sql.ts`, `event/sql.ts`, `permission/sql.ts`,
`project/sql.ts`, `session/sql.ts`, `share/sql.ts`, `data-migration.sql.ts`,
`control-plane/workspace.sql.ts`, `database/schema.sql.ts` (Timestamps),
`database/path.ts` (custom column types).

### 2b. Vendored adapter
`packages/effect-drizzle-sqlite/**` (driver, session, migrator, and the copied
`sqlite-core/effect/*` query builders: count/db/delete/insert/query/raw/select/session/update).

### 2c. Driver / runtime
`database/sqlite.node.ts`, `database/sqlite.bun.ts`, `database/sqlite.ts`,
`packages/effect-sqlite-node/**`, the `#sqlite` conditional import in
`packages/core/package.json`, and `database/database.ts` (PRAGMAs + `path()`).

### 2d. Migration runner + DDL
`database/migration.ts` (uses `sqlite_master`, `INSERT OR IGNORE`,
`__drizzle_migrations`), `database/schema.gen.ts` (SQLite baseline DDL),
`database/migration.gen.ts` (imports 38 files), `database/migration/*.ts`
(SQLite DDL: backticks, `AUTOINCREMENT`, `PRAGMA`, table‑rebuild pattern,
`json_extract`, `GLOB`, `char(92)`, `instr`, `REPLACE`).

### 2e. Tooling / tests / misc
`packages/core/drizzle.config.ts` (`dialect: "sqlite"`),
`packages/opencode/src/cli/cmd/db.ts` (spawns `sqlite3`, uses `db.all`),
`packages/core/test/database-migration.test.ts` (`:memory:`), the
`@effect/sql-sqlite-bun` catalog dep, and `Flag.OPENCODE_DB`.
Also update opencode tests/fixtures that assume SQLite paths:
`packages/opencode/test/fixture/db.ts`, `packages/opencode/test/preload.ts`,
`packages/opencode/test/cli/smokes/read-only.test.ts`, and
`packages/opencode/test/server/httpapi-exercise/environment.ts`.

### 2g. Type-only SQLite adapter imports outside the DB package
`packages/core/src/project/directories.ts` imports
`EffectDrizzleSqlite.EffectSQLiteDatabase` only for a local helper type. Replace
that with the Postgres database type (or, better, derive the type from
`Database.Interface["db"]`) during the cutover.

### 2f. SQLite‑specific SQL that must be rewritten
- PRAGMAs in `database.ts` (WAL / synchronous / busy_timeout / cache_size / foreign_keys / wal_checkpoint) → **remove** (no pg equivalent needed).
- `SELECT ... FROM sqlite_master` (2×, `migration.ts`) → `information_schema.tables` / `pg_catalog`.
- `INSERT OR IGNORE` (`migration.ts`) → `INSERT ... ON CONFLICT DO NOTHING`.
- `json_extract(...)`, `GLOB`, `char(92)`, `instr`, `PRAGMA table_info` — only inside the 38 legacy migrations, which we drop for pg.
- Query‑builder `onConflictDoUpdate` / `onConflictDoNothing` (`event.ts`, `permission/saved.ts`, `project/directories.ts`, `session.ts`, `session/input.ts`, `session/projector.ts`) — **compatible with pg-core, no change** (pg `onConflictDoNothing()` and `onConflictDoUpdate({target,set})` supported).

---

## 3. Column type mapping (SQLite → Postgres)

| Current (sqlite-core) | Meaning | Postgres (pg-core) | Notes |
|---|---|---|---|
| `text()` | string | `text()` | 1:1 |
| `text({ mode: "json" })` | JSON stored as TEXT | `jsonb().$type<T>()` | Storage changes TEXT→JSONB; ETL must `JSON.parse` old text |
| `integer()` for `time_*` (`Date.now()`) | epoch **ms** (~1.7e12) | `bigint({ mode: "number" })` | **Must be bigint** — exceeds int4 max (2.1e9); < 2^53 so `number` mode is safe |
| `integer()` for `seq`/`admitted_seq`/`promoted_seq`/`baseline_seq`/counters/`position`/`summary_*`/tokens | counter | `bigint({ mode: "number" })` | Uniform bigint avoids overflow surprises |
| `integer({ mode: "boolean" })` (`control_account.active`, `credential.active`) | 0/1 | `boolean()` | ETL converts 0/1 → false/true |
| `real()` (`session.cost`) | float | `doublePrecision()` | |
| `integer().primaryKey()` (`account_state.id`) | single‑row id | `integer().primaryKey()` | value 0/1 |
| `DatabasePath.*Column()` custom types (`dataType()="text"`) | path/JSON‑as‑text | keep `customType` but import from `drizzle-orm/pg-core`; `dataType()` returns `"text"` | Logic unchanged; only the import module changes |

`Timestamps` (`database/schema.sql.ts`) becomes:
```ts
import { bigint } from "drizzle-orm/pg-core"
export const Timestamps = {
  time_created: bigint({ mode: "number" }).notNull().$default(() => Date.now()),
  time_updated: bigint({ mode: "number" }).notNull().$onUpdate(() => Date.now()),
}
```

All `sqliteTable(...)` → `pgTable(...)`; `index`/`uniqueIndex`/`primaryKey`
imports move to `drizzle-orm/pg-core` (same call shapes). Composite PKs and named
indexes port directly.

---

## 4. Implementation phases

### Phase 0 — Verify upstream Drizzle Effect‑pg support (spike, blocking)
Before writing the adapter, confirm whether `drizzle-orm@1.0.0-rc.2` ships an
Effect binding for `pg-core` (e.g. `drizzle-orm/effect-pg` or
`drizzle-orm/pg-core/effect/*`). The sqlite adapter's `AGENTS.md` says it vendors
these "so this can be replaced by upstream `drizzle-orm/effect-sqlite` later" —
so an upstream `effect-pg` may already exist.
- If **yes** → the vendored package is thin (just the driver/session wiring).
- If **no** → vendor `pg-core/effect/*` the same way the sqlite package did.
Deliverable: a one‑paragraph finding that sets Phase 2 scope.

### Phase 1 — Dependencies & catalog
- Root `package.json` catalog: add
  - `@effect/sql-pg` (match `@effect/sql-sqlite-bun` version, `4.0.0-beta.83`) — **runtime driver**.
  - No `postgres` package is needed. `@effect/sql-pg@4.0.0-beta.83` uses the
    `pg` driver stack (`pg`, `pg-pool`, `pg-cursor`, `pg-types`) as its own
    dependencies. Add a direct `pg` dependency only if opencode imports `pg`
    directly.
  - `@electric-sql/pglite` — **tests only** (in‑process Postgres so CI needs no server); omit if tests use a real/Dockerized Postgres.
- Keep `@effect/sql-sqlite-bun` only until the ETL command is done, then remove.
- Add `@opencode-ai/effect-drizzle-pg` workspace package; make `@opencode-ai/core`
  depend on it and drop `@opencode-ai/effect-drizzle-sqlite` /
  `@opencode-ai/effect-sqlite-node` once cut over.

### Phase 2 — Vendor `@opencode-ai/effect-drizzle-pg`
Mirror `packages/effect-drizzle-sqlite` for Postgres:
- `src/effect-pg/driver.ts` — `make` / `makeWithDefaults` using `PgDialect`
  (`drizzle-orm/pg-core/dialect`), `EffectCache`, `EffectLogger`.
- `src/effect-pg/session.ts` — bridge Effect `SqlClient` → Drizzle pg session.
  Transaction control uses `begin` / `savepoint effect_sql_N` /
  `release savepoint` / `rollback [to savepoint]` (drop SQLite's `deferred`
  behavior; pg `begin` takes no isolation keyword in that slot). Reuse the exact
  `withTransaction` structure from the sqlite session.
- `src/effect-pg/migrator.ts` — analog of the sqlite migrator (optional; the app
  uses its own runner).
- `src/pg-core/effect/*` — only if Phase 0 shows no upstream; copy the
  `pg-core` internal builders and adapt to Effect, exactly as
  `src/sqlite-core/effect/*` did.
- Expose a `.run/.all/.get/.values` compatibility shim on the returned database
  (pg drizzle natively exposes `.execute`) so the runner/CLI keep working with
  minimal edits — OR standardize on `.execute` and update the migration runner,
  `schema.gen.ts`, CLI DB command, and tests together.
- Port `examples/basic.ts` + `test/pg.test.ts` (run against PGlite).

### Phase 3 — Schema files → `pg-core`
Rewrite the 11 schema files per §3. Purely mechanical:
- `sqliteTable`→`pgTable`, `integer`→`bigint({mode:"number"})` (timestamps/seqs),
  `integer({mode:"boolean"})`→`boolean`, `real`→`doublePrecision`,
  `text({mode:"json"})`→`jsonb`, `path.ts` customType import → `pg-core`.
- `.$type<...>()`, `.references()`, `.notNull()`, `.default()`, `.primaryKey()`,
  composite `primaryKey({columns})`, `index`/`uniqueIndex` all carry over.

### Phase 4 — Driver/runtime layer

**4a. Postgres `SqlClient` (external server)**
- Use `@effect/sql-pg` `PgClient.layer({ url: Redacted.make(url) })` as the runtime `SqlClient`.
  `PgClientConfig.url` is a `Redacted`, so wrap string URLs with
  `Redacted.make(url)`. Feed the resulting layer into `EffectDrizzlePg` (Phase
  2). No custom runtime driver file is needed (unlike the SQLite path, which
  wrapped `node:sqlite`/`bun:sqlite`).
- Collapse the `#sqlite` conditional import: one pg client serves both node and
  bun. Remove `sqlite.node.ts`, `sqlite.bun.ts`, `sqlite.ts`, `#sqlite`, and the
  `effect-sqlite-node` package.
- **Tests only:** a small PGlite‑backed `SqlClient` layer (`database/pglite.ts`)
  so unit tests run without a server; production never loads it.

**4b. `database/database.ts`**
- Swap `EffectDrizzleSqlite.makeWithDefaults()` → `EffectDrizzlePg.makeWithDefaults()`.
- **Delete all PRAGMA `db.run(...)` calls** (SQLite‑only).
- Replace `path()`/`layerFromPath(filename)` with `connectionConfig()` /
  `layerFromConfig(config)` that builds `PgClient.layer(config)`. Resolve the
  config via the **§1a resolution order**. Explicit URLs become
  `{ url: Redacted.make(url) }`; `PG*` env fallback can pass an empty config and
  let `pg` read standard env vars.
- `Database.node` still constructs at module load using the resolved connection
  config. If JSON `database.url` is implemented, make this layer config-aware per §1a.
- Add `Flag.OPENCODE_DATABASE_URL`; keep `OPENCODE_DB` as a URL alias.
- Provide `Database.connection()` or `Database.url()` for CLI/tools. If the
  connection came from `PG*` env vars, the CLI should invoke `psql` with no URL
  and inherit the environment instead of trying to synthesize a password-bearing
  URL.
- If JSON `database.url` is implemented, add `ConfigDatabase.Info` and make the
  DB layer depend on config before client construction. Keep env vars as the
  highest-priority override so production deployments can swap DBs without
  editing repo/project config.

### Phase 5 — Migration runner + baseline DDL
- **`database/schema.gen.ts`** → rewrite as **Postgres DDL** (single squashed
  baseline). Convert every `CREATE TABLE`:
  - backtick identifiers → double quotes (or unquoted lowercase).
  - `integer` timestamps/seqs → `bigint`; `integer` booleans → `boolean`;
    `real` → `double precision`; JSON `text` → `jsonb`.
  - `PRIMARY KEY`, `FOREIGN KEY ... ON DELETE CASCADE/SET NULL`, composite PKs,
    and all `CREATE [UNIQUE] INDEX` statements carry over (index syntax is
    identical).
  - Use `.execute()` (or the `.run` shim) instead of SQLite `tx.run`.
- **`database/migration.ts`**:
  - Table existence probe `sqlite_master` →
    `SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public'`.
  - `INSERT OR IGNORE` → `INSERT ... ON CONFLICT (id) DO NOTHING`.
  - Drop the `__drizzle_migrations` seeding branch (never existed on pg).
  - `migration` bookkeeping table DDL: `time_completed` → `bigint`.
- **`database/migration.gen.ts`** → export an **empty** `migrations` array for pg
  (fresh DBs need no incremental steps beyond the baseline). Remove the
  `database/migration/*` SQLite files from the pg build (retain them only if you
  also keep a sqlite‑read path for the ETL — see §7).

### Phase 6 — Tooling
- `packages/core/drizzle.config.ts` → `dialect: "postgresql"`,
  `dbCredentials: { url: process.env.OPENCODE_DATABASE_URL ?? process.env.OPENCODE_DB }`
  when that value is a Postgres URL. Drizzle Kit runs outside the app runtime, so
  document that schema generation uses env config even if app runtime also
  supports `opencode.json`.
- `packages/opencode/src/cli/cmd/db.ts`:
  - `spawn("sqlite3", [Database.path()])` → `spawn("psql", Database.psqlArgs())`
    (inherits stdio for an interactive shell; pass a URL only when one was
    explicitly configured, otherwise rely on inherited `PG*` env vars).
  - `db.all(sql.raw(query))` → `db.execute(sql.raw(query))` (or `.all` shim).
  - `PathCommand`/`path` → `connection`/`url` (print a masked connection string
    or a summary that says `PG* env` when no URL is available).
  - Update `describe` text ("sqlite3 shell" → "psql shell").

### Phase 7 — Data migration for existing installs (ETL)
Ship a one‑time `opencode db import-sqlite` (or auto‑run on first pg boot if a
legacy file exists):
1. Open the legacy SQLite file with the **retained** sqlite layer (read‑only).
2. Ensure the pg baseline schema exists.
3. Copy tables in FK‑dependency order:
   `project → workspace → project_directory → session → message → part →
   session_message → session_input → session_context_epoch → todo →
   session_share → event_sequence → event → account → account_state →
   control_account → credential → permission → data_migration`.
4. Transform per §3: booleans `0/1`→bool, JSON **text**→object for `jsonb`
   columns, epoch ints unchanged.
5. Wrap in a transaction; insert parents before children (or defer FKs). Verify
   row counts per table; keep the SQLite file as backup.

### Phase 8 — Tests
- Add a **PGlite‑backed test layer** (in‑process, no server) to replace
  `:memory:` sqlite. Provide `Database.layerFromPglite(dir)` for tests.
- Rewrite `packages/core/test/database-migration.test.ts` to assert the pg
  baseline applies cleanly and the `migration` bookkeeping table is created.
- Update `packages/core/test/preload.ts` and `packages/opencode/test/preload.ts`
  so tests no longer set `OPENCODE_DB=":memory:"`; use a test Postgres URL or
  PGlite test layer instead.
- Update opencode DB-path smoke tests and fixtures:
  `packages/opencode/test/fixture/db.ts`,
  `packages/opencode/test/cli/smokes/read-only.test.ts`, and
  `packages/opencode/test/server/httpapi-exercise/environment.ts`.
- Run `bun typecheck` per package and the `packages/core` / `packages/opencode`
  test suites (tests must run from package dirs, not root).

---

## 5. Files created / modified / deleted (checklist)

**Create**
- `packages/effect-drizzle-pg/**` (new workspace package).
- `packages/core/src/database/pglite.ts` (**tests only** `SqlClient`; skip if tests use a real Postgres).
- `packages/opencode/src/cli/cmd/*` ETL command (Phase 7).

**Modify**
- 11 schema files (§2a) → `pg-core`.
- `database/database.ts`, `database/migration.ts`, `database/schema.gen.ts`,
  `database/migration.gen.ts`, `database/path.ts`, `database/schema.sql.ts`.
- `packages/core/package.json` (deps, drop `#sqlite` import), root
  `package.json` catalog, `packages/core/drizzle.config.ts`.
- `packages/opencode/src/cli/cmd/db.ts`.
- `packages/core/test/database-migration.test.ts`.

**Delete (after cutover)**
- `database/sqlite.node.ts`, `database/sqlite.bun.ts`, `database/sqlite.ts`,
  `packages/effect-sqlite-node/**`, `packages/effect-drizzle-sqlite/**`
  (keep sqlite read‑path until ETL is retired), `database/migration/*.ts` (pg).

---

## 6. Risks & gotchas
- **bigint round‑tripping.** `@effect/sql-pg` / `postgres` return `int8` as string
  by default; ensure drizzle `bigint({mode:"number"})` casts, and that the Effect
  client doesn't force `SafeIntegers`/bigint globally. Validate reads of
  `time_created`, `seq`, tokens.
- **JSONB vs TEXT.** Drizzle `jsonb` sends objects; the driver must not
  double‑encode. ETL must parse legacy text. Round‑trip test each JSON column.
- **Transaction semantics.** Pg `begin` has no `deferred` keyword in that
  position; the SQLite "constraint commit failure keeps txn open" workaround is
  unnecessary — adapt the pg session accordingly.
- **Single‑writer expectations.** SQLite path used a semaphore (1 connection).
  PGlite is single‑connection too; a real pg server allows concurrency — verify
  the `event_sequence`/`session_input` sequence logic is safe under real
  concurrency (it relies on unique indexes + `ON CONFLICT`, which is fine).
- **Upstream `effect-pg` availability (Phase 0)** is the biggest scope swing.
- **Identifier casing.** Unquoted pg identifiers fold to lowercase; the schema
  already uses snake_case lowercase, so this is safe — keep table/column names
  lowercase and avoid quoting inconsistencies between DDL and drizzle.
- **`onConflictDoNothing()` with no target** works in pg; `onConflictDoUpdate`
  requires a `target` (already provided in `projector.ts`).

## 7. Rollback
The change is additive until the driver is switched in `database.ts`. Keep the
sqlite layer behind the ETL until stable; revert = point `database.ts` back at
`EffectDrizzleSqlite` + the sqlite client layer.

## 8. Effort estimate (rough)
- Phase 0 spike: 0.5 d · Phase 2 adapter: 2–4 d (thin if upstream exists) ·
  Phase 3 schema: 0.5 d · Phase 4 driver: 1–2 d · Phase 5 runner/DDL: 1 d ·
  Phase 6 tooling: 0.5 d · Phase 7 ETL: 1–2 d · Phase 8 tests: 1 d.
