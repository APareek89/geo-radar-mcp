import { defineConfig } from "drizzle-kit";

// Generate/apply migrations against Postgres. Requires DATABASE_URL in the env.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://geo:geo@localhost:5432/geo_radar",
  },
});
