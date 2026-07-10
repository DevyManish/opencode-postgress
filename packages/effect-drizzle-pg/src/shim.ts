import * as Effect from "effect/Effect"
import {
  PgEffectDeleteBase,
  PgEffectInsertBase,
  PgEffectSelectBase,
  PgEffectUpdateBase,
} from "drizzle-orm/pg-core/effect"
import type { Assume } from "drizzle-orm/utils"
import type { ColumnsSelection, SQL } from "drizzle-orm/sql/sql"
import type { QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import type { PgTable } from "drizzle-orm/pg-core/table"
import type { PgQueryResultHKT, PgQueryResultKind } from "drizzle-orm/pg-core/session"
import type { PgViewBase } from "drizzle-orm/pg-core/view-base"
import type { Join } from "drizzle-orm/pg-core/query-builders/update"
import type { Subquery } from "drizzle-orm/subquery"
import type {
  BuildSubquerySelection,
  JoinNullability,
  SelectMode,
  SelectResult,
} from "drizzle-orm/query-builders/select.types"

// The upstream `drizzle-orm` Effect query builders are themselves `Effect`
// values (yielding them runs the query). The SQLite adapter this package
// replaces exposed `.all()` / `.get()` / `.run()` terminal helpers, which the
// opencode codebase relies on. Restore them here so the call sites are
// dialect-agnostic. `all` / `run` return the builder-as-effect unchanged, while
// `get` maps to the first row.
function patch(ctor: { prototype: any }) {
  const proto = ctor.prototype
  if (typeof proto["all"] === "function") return
  proto["all"] = function (this: Effect.Effect<unknown, unknown, unknown>) {
    return this
  }
  proto["run"] = function (this: Effect.Effect<unknown, unknown, unknown>) {
    return this
  }
  proto["get"] = function (this: Effect.Effect<ReadonlyArray<unknown>, unknown, unknown>) {
    return Effect.map(this, (rows) => (Array.isArray(rows) ? rows[0] : rows))
  }
}

patch(PgEffectSelectBase)
patch(PgEffectInsertBase)
patch(PgEffectUpdateBase)
patch(PgEffectDeleteBase)

declare module "drizzle-orm/pg-core/effect/select" {
  interface PgEffectSelectBase<
    TTableName extends string | undefined,
    TSelection extends ColumnsSelection | undefined,
    TSelectMode extends SelectMode,
    TNullabilityMap extends Record<string, JoinNullability> = TTableName extends string
      ? Record<TTableName, "not-null">
      : {},
    TDynamic extends boolean = false,
    TExcludedMethods extends string = never,
    TResult extends any[] = SelectResult<TSelection, TSelectMode, TNullabilityMap>[],
    TSelectedFields extends ColumnsSelection = BuildSubquerySelection<Assume<TSelection, ColumnsSelection>, TNullabilityMap>,
    TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
  > {
    all(): this
    run(): this
    get(): Effect.Effect<TResult[number] | undefined, TEffectHKT["error"], TEffectHKT["context"]>
  }
}

declare module "drizzle-orm/pg-core/effect/insert" {
  interface PgEffectInsertBase<
    TTable extends PgTable,
    TQueryResult extends PgQueryResultHKT,
    TSelectedFields = undefined,
    TReturning = undefined,
    TDynamic extends boolean = false,
    TExcludedMethods extends string = never,
    TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
  > {
    all(): this
    run(): this
    get(): Effect.Effect<
      (TReturning extends undefined ? never : TReturning) | undefined,
      TEffectHKT["error"],
      TEffectHKT["context"]
    >
  }
}

declare module "drizzle-orm/pg-core/effect/update" {
  interface PgEffectUpdateBase<
    TTable extends PgTable,
    TQueryResult extends PgQueryResultHKT,
    TFrom extends PgTable | Subquery | PgViewBase | SQL | undefined = undefined,
    TSelectedFields extends ColumnsSelection | undefined = undefined,
    TReturning extends Record<string, unknown> | undefined = undefined,
    TNullabilityMap extends Record<string, JoinNullability> = Record<TTable["_"]["name"], "not-null">,
    TJoins extends Join[] = [],
    TDynamic extends boolean = false,
    TExcludedMethods extends string = never,
    TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
  > {
    all(): this
    run(): this
    get(): Effect.Effect<
      (TReturning extends undefined ? never : TReturning) | undefined,
      TEffectHKT["error"],
      TEffectHKT["context"]
    >
  }
}

declare module "drizzle-orm/pg-core/effect/delete" {
  interface PgEffectDeleteBase<
    TTable extends PgTable,
    TQueryResult extends PgQueryResultHKT,
    TSelectedFields extends ColumnsSelection | undefined = undefined,
    TReturning extends Record<string, unknown> | undefined = undefined,
    TDynamic extends boolean = false,
    TExcludedMethods extends string = never,
    TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
  > {
    all(): this
    run(): this
    get(): Effect.Effect<
      (TReturning extends undefined ? never : TReturning) | undefined,
      TEffectHKT["error"],
      TEffectHKT["context"]
    >
  }
}

// Referenced only to keep the unused-import checker satisfied for types that
// participate solely in the augmentation signatures above.
export type {}
