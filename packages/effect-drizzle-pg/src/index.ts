export { EffectLogger } from "drizzle-orm/effect-core"
export * from "drizzle-orm/effect-postgres"
export { migrate } from "drizzle-orm/effect-postgres/migrator"

import "./shim"

export * as EffectDrizzlePg from "."
