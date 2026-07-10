import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    url:
      process.env["OPENCODE_DATABASE_URL"] ??
      process.env["OPENCODE_DB"] ??
      "postgres://postgres@127.0.0.1:5432/opencode",
  },
})
