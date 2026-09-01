import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  noExternal: ["@bi-agent/contracts", "@bi-agent/database"],
  external: ["better-sqlite3"],
});
