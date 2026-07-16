import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Load `.env` for local runs. When Claude Desktop launches the built bin, the cwd
 * may be anywhere, so we walk up from cwd looking for a `.env` (the monorepo root)
 * before falling back to dotenv's default.
 */
export function loadEnv(startDir: string = process.cwd()): void {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  config();
}
