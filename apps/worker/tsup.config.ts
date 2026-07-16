import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  dts: false,
  noExternal: [/^@geo-radar\//],
  banner: { js: "#!/usr/bin/env node" },
});
