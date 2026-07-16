import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/**
 * A driver-agnostic Drizzle handle. `DrizzleStore` depends on this, so the same
 * store code runs over real Postgres (node-postgres) in production and over an
 * embedded Postgres (pglite) in tests — both are `PgDatabase`s.
 */
export interface DbHandle {
  db: PgDatabase<any, any, any>;
  close: () => Promise<void>;
}

/** Open a Postgres-backed Drizzle handle. Call `close()` (or store.close()) to release it. */
export function createDb(connectionString: string): DbHandle {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
