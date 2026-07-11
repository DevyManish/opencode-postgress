# Database Setup & Usage Guide (Postgres)

Everything you need to run opencode against Postgres locally or against an
external server: **prerequisites**, **environment variables**, **starting a
Postgres**, **running the dev server**, **building**, and **day‑to‑day database
commands**.

> For the design/architecture behind the migration, see
> [`postgres-migration.md`](./postgres-migration.md).

---

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| [Bun](https://bun.sh) | `1.3.14` (the repo's `packageManager`) | Primary runtime, package manager, and test runner. |
| Postgres | 16+ recommended | Any reachable server: local install, Docker, or managed cloud. |
| `psql` client | matches server | Optional but recommended — used by `opencode db`. |
| Docker | any recent | Optional — easiest way to run a local Postgres. |
| Git | any | Repo uses git worktrees for sessions. |

Install workspace dependencies from the repo root:

```bash
bun install
```

> On Windows, if a native postinstall step fails, use
> `bun install --ignore-scripts`.

---

## 2. Environment variables

opencode resolves its Postgres connection at runtime in this **priority order**
(first match wins):

| Priority | Variable(s) | Behaviour |
| --- | --- | --- |
| 1 | `OPENCODE_DATABASE_URL` | Full Postgres URL. Highest priority. |
| 2 | `OPENCODE_DB` | Used **only if** it looks like `postgres://…` / `postgresql://…`. |
| 3 | `PGHOST` / `PGDATABASE` / `PGUSER` / `PGPORT` (standard `PG*`) | If any is set, opencode passes an empty config and lets the underlying `pg` driver read the `PG*` vars itself. |
| 4 | _none of the above_ | Falls back to `postgres://postgres@127.0.0.1:5432/opencode`. |

### Connection URL format

```
postgres://<user>:<password>@<host>:<port>/<database>
```

Example:

```bash
# Linux / macOS
export OPENCODE_DATABASE_URL="postgres://testuser:test123@localhost:5433/opencode"
```

```powershell
# Windows PowerShell
$env:OPENCODE_DATABASE_URL = "postgres://testuser:test123@localhost:5433/opencode"
```

### Standard `PG*` variables (alternative to a URL)

If you prefer, set the connection with the driver's native vars and leave
`OPENCODE_DATABASE_URL` unset:

| Variable | Meaning |
| --- | --- |
| `PGHOST` | Server host (e.g. `localhost`) |
| `PGPORT` | Server port (e.g. `5432`) |
| `PGUSER` | Role/username |
| `PGPASSWORD` | Password |
| `PGDATABASE` | Database name |

### Test‑only variables

| Variable | Purpose |
| --- | --- |
| `OPENCODE_DATABASE_URL` | Primary DB the test suite connects to. |
| `OPENCODE_TEST_TARGET_DATABASE_URL` | Secondary DB used by cross‑database replay tests (e.g. `…/opencode_target`). |

---

## 3. Start a local Postgres

### Option A — Docker (recommended)

```bash
docker run -d --name opencode-pg \
  -e POSTGRES_USER=testuser \
  -e POSTGRES_PASSWORD=test123 \
  -e POSTGRES_DB=opencode \
  -p 5433:5432 \
  postgres:16-alpine
```

Create the secondary database used by some tests:

```bash
docker exec opencode-pg psql -U testuser -d opencode -c "CREATE DATABASE opencode_target;"
```

Then point opencode at it:

```bash
export OPENCODE_DATABASE_URL="postgres://testuser:test123@localhost:5433/opencode"
```

### Option B — Local install

Create a database and user, then export a matching `OPENCODE_DATABASE_URL`:

```bash
createdb opencode
export OPENCODE_DATABASE_URL="postgres://$USER@localhost:5432/opencode"
```

### Option C — Managed / cloud Postgres

Just set the provider's connection string (append `?sslmode=require` if needed):

```bash
export OPENCODE_DATABASE_URL="postgres://user:pass@db.example.com:5432/opencode?sslmode=require"
```

> **No manual schema step is required.** opencode runs its migration runner
> automatically on first connection: an empty database gets the squashed baseline
> schema; an existing one gets any missing incremental migrations.

---

## 4. Run the dev server

From the **repo root**:

```bash
bun run dev
```

This runs `packages/opencode/src/index.ts` (equivalent to
`bun run --cwd packages/opencode --conditions=browser src/index.ts`).

Or from within the CLI package:

```bash
cd packages/opencode
bun run dev
```

Make sure a Postgres connection is configured (section 2/3) **before** starting —
the server applies migrations against it on startup.

Other dev entrypoints (unchanged by the migration):

| Command | Runs |
| --- | --- |
| `bun run dev` | opencode CLI/server |
| `bun run dev:desktop` | Desktop app |
| `bun run dev:web` | Web app |
| `bun run dev:console` | Console app |
| `bun run dev:storybook` | Storybook |

---

## 5. Build

Build the opencode CLI:

```bash
cd packages/opencode
bun run build          # runs script/build.ts
```

Typecheck the whole workspace (Turbo fan‑out):

```bash
# repo root
bun run typecheck
```

Typecheck a single package (use the package's own script — never call `tsc`
directly):

```bash
cd packages/core
bun typecheck
```

Lint:

```bash
# repo root
bun run lint           # oxlint
```

---

## 6. Database commands (`opencode db`)

The CLI ships DB helpers that respect the same connection resolution.

Open an interactive `psql` shell against the configured database:

```bash
opencode db
```

Run a one‑off query (default `tsv`, or `--format json`):

```bash
opencode db "select id, name from project limit 5"
opencode db "select count(*) from session" --format json
```

Print the resolved connection (or `PG* environment variables` when using `PG*`):

```bash
opencode db connection
```

---

## 7. Schema tooling (Drizzle Kit)

`packages/core/drizzle.config.ts` is set to `dialect: "postgresql"` and reads the
URL from `OPENCODE_DATABASE_URL` → `OPENCODE_DB` → the local default.

```bash
cd packages/core
bun run db            # bun drizzle-kit
```

> The application's **runtime** migration runner (in `database/migration.ts`) is
> what actually creates/updates the schema on startup. Drizzle Kit is for
> authoring/inspecting schema changes during development.

---

## 8. Running tests

Tests must run from a **package directory** (a root guard blocks `bun test` at the
repo root). Provide a live Postgres via the test env vars.

```bash
cd packages/core

# Linux / macOS
export OPENCODE_DATABASE_URL="postgres://testuser:test123@localhost:5433/opencode"
export OPENCODE_TEST_TARGET_DATABASE_URL="postgres://testuser:test123@localhost:5433/opencode_target"
bun test
```

```powershell
# Windows PowerShell
cd packages/core
$env:OPENCODE_DATABASE_URL = "postgres://testuser:test123@localhost:5433/opencode"
$env:OPENCODE_TEST_TARGET_DATABASE_URL = "postgres://testuser:test123@localhost:5433/opencode_target"
bun test
```

To reset a database between full runs:

```bash
docker exec opencode-pg psql -U testuser -d opencode -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

> The suite also performs **per‑test isolation** automatically (it truncates
> tables between tests) to mirror the fresh‑DB behaviour SQLite `:memory:` used to
> provide.

---

## 9. Quick start (copy‑paste)

```bash
# 1. Start Postgres
docker run -d --name opencode-pg \
  -e POSTGRES_USER=testuser -e POSTGRES_PASSWORD=test123 -e POSTGRES_DB=opencode \
  -p 5433:5432 postgres:16-alpine

# 2. Configure the connection
export OPENCODE_DATABASE_URL="postgres://testuser:test123@localhost:5433/opencode"

# 3. Install deps
bun install

# 4. Run (migrations apply automatically on startup)
bun run dev
```

```mermaid
flowchart LR
    A[Start Postgres] --> B[Set OPENCODE_DATABASE_URL]
    B --> C[bun install]
    C --> D[bun run dev]
    D --> E[Migrations apply on startup]
    E --> F[App connected to Postgres]
```

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `password authentication failed` | URL user/password don't match the server. Check `OPENCODE_DATABASE_URL` against your Postgres credentials. |
| `ECONNREFUSED` / connection refused | Server not running or wrong host/port. Verify the container/port (e.g. host `5433`). |
| `Database is not empty and has no session table` | You pointed at a **non‑empty, unrelated** database. Use a dedicated/empty database for opencode. |
| App ignores my `OPENCODE_DB` | `OPENCODE_DB` is only used when it is a `postgres://` URL; otherwise it's skipped. Prefer `OPENCODE_DATABASE_URL`. |
| `opencode db` can't open a shell | `psql` isn't on `PATH`. Install the Postgres client, or use `opencode db "<query>"` which goes through the app driver instead. |
| Tests fail at the repo root | Run `bun test` from inside a package dir (e.g. `packages/core`). |
