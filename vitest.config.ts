import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": process.cwd().replace(/\\/g, "/") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
