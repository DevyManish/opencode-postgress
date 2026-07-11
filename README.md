<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent — <strong>Postgres edition</strong>.</p>

---

> [!IMPORTANT]
> **This is a fork of [opencode](https://github.com/anomalyco/opencode).**
> The upstream project stores all durable state in a local **SQLite** file. This
> fork replaces that with an **external, config‑swappable Postgres server**, so
> the same binary can point at a local container, a shared team database, or a
> managed cloud Postgres — selected entirely through configuration.
>
> It is **not** built by or affiliated with the upstream opencode team.

### What's different in this fork

- 🐘 **Postgres instead of SQLite.** Durable state lives in an external Postgres
  server (via `@effect/sql-pg` → node `pg` + Drizzle `pg-core`).
- 🔀 **Config‑swappable connection.** One env var (`OPENCODE_DATABASE_URL`)
  repoints the whole app; standard `PG*` variables and managed cloud URLs work
  out of the box.
- 🤝 **Shareable & concurrent.** State is no longer trapped in one machine's file
  — multiple processes / a team can share one server, with real connection
  pooling and concurrency.
- 🧱 **Automatic migrations.** The schema is created/updated on startup: an empty
  database gets the squashed baseline; an existing one gets missing incrementals.
- 🧩 **Dialect‑agnostic call sites.** Application code still uses the Drizzle query
  builder, so the engine sits behind a single `Database.Service` and a thin
  adapter package.

Everything else — the agent, TUI, tools, and workflows — behaves like upstream
opencode.

### Fork documentation

| Doc | What it covers |
| --- | --- |
| 📐 [`docs/postgres-migration.md`](./docs/postgres-migration.md) | What/where/how the SQLite→Postgres change was done, the resulting architecture, and its benefits (with diagrams). |
| 🛠️ [`docs/database-setup.md`](./docs/database-setup.md) | Prerequisites, environment variables, starting Postgres, running the dev server, building, and day‑to‑day database commands. |

For the original design plan, see
[`packages/core/src/database/POSTGRES_MIGRATION.md`](./packages/core/src/database/POSTGRES_MIGRATION.md).

### Quick start (Postgres)

```bash
# 1. Start a local Postgres (Docker)
docker run -d --name opencode-pg \
  -e POSTGRES_USER=testuser -e POSTGRES_PASSWORD=test123 -e POSTGRES_DB=opencode \
  -p 5433:5432 postgres:16-alpine

# 2. Point opencode at it
export OPENCODE_DATABASE_URL="postgres://testuser:test123@localhost:5433/opencode"

# 3. Install deps and run (migrations apply automatically on startup)
bun install
bun run dev
```

> **Connection resolution order:** `OPENCODE_DATABASE_URL` → `OPENCODE_DB` (only
> if it's a `postgres://` URL) → standard `PG*` env vars → local default
> (`postgres://postgres@127.0.0.1:5432/opencode`).
> Full details in [`docs/database-setup.md`](./docs/database-setup.md).

### Database commands

```bash
opencode db                                   # interactive psql shell
opencode db "select id, name from project"    # run a query (add --format json)
opencode db connection                        # print the resolved connection
```

---

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installation (upstream opencode)

> The packages below install **upstream** opencode (SQLite). This fork runs from
> source against Postgres — see **Quick start** above.

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

**This fork:** [`docs/database-setup.md`](./docs/database-setup.md) (setup, env
vars, dev server, build) and [`docs/postgres-migration.md`](./docs/postgres-migration.md)
(architecture & changes).

For general opencode configuration, [**head over to the upstream docs**](https://opencode.ai/docs).

### Building & running this fork

```bash
bun install                 # install workspace deps (repo root)
bun run dev                 # run the opencode CLI/server against Postgres
bun run typecheck           # typecheck the workspace
cd packages/opencode && bun run build   # build the CLI
```

See [`docs/database-setup.md`](./docs/database-setup.md) for prerequisites and the
full set of commands.

### Contributing

If you're interested in contributing to upstream OpenCode, please read the
[contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
