import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  dts: false,
  // Bundle the workspace `@geo-radar/*` packages into the output so the published
  // `geo-radar-mcp` bin is self-contained and installable via npx.
  noExternal: [/^@geo-radar\//],
  // The bin must be executable; tsup prepends the shebang for us.
  banner: { js: "#!/usr/bin/env node" },
});
