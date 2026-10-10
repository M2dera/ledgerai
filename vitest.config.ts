import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": process.cwd().replace(/\\/g, "/"),
      "server-only": `${process.cwd().replace(/\\/g, "/")}/tests/server-only.ts`,
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
