export * as Database from "./database"

import { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"
import { PgClient } from "@effect/sql-pg"
import { Context, Effect, Layer, Redacted } from "effect"
import { Flag } from "../flag/flag"
import { DatabaseMigration } from "./migration"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzlePg.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase
    yield* DatabaseMigration.apply(db)
    return { db }
  }).pipe(Effect.orDie),
)

const DEFAULT_URL = "postgres://postgres@127.0.0.1:5432/opencode"

export function layerFromConfig(config: PgClient.PgPoolConfig) {
  return layer.pipe(Layer.provide(PgClient.layer(config).pipe(Layer.orDie)))
}

// Builds a Database layer for an explicit Postgres connection string. Useful for
// tooling and tests that need to target a database other than the process default.
export function layerFromUrl(connectionString: string) {
  return layerFromConfig({ url: Redacted.make(connectionString) })
}

export function connectionConfig(): PgClient.PgPoolConfig {
  const explicit = url()
  // When no URL is configured we pass an empty config and let the `pg` driver
  // resolve the connection from standard PG* environment variables.
  if (!explicit) return {}
  return { url: Redacted.make(explicit) }
}

// Resolves the Postgres connection string per the config swap order:
// 1. OPENCODE_DATABASE_URL, 2. OPENCODE_DB (when it is a postgres URL),
// 3. PG* env vars (returns undefined so `pg` reads them), 4. local default.
export function url() {
  if (Flag.OPENCODE_DATABASE_URL) return Flag.OPENCODE_DATABASE_URL
  if (Flag.OPENCODE_DB && /^postgres(ql)?:\/\//i.test(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
  if (process.env["PGHOST"] || process.env["PGDATABASE"] || process.env["PGUSER"] || process.env["PGPORT"])
    return undefined
  return DEFAULT_URL
}

export const node = makeGlobalNode({ service: Service, layer: layerFromConfig(connectionConfig()), deps: [] })
