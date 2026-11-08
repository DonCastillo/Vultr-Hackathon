import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // server/ files start with `import "server-only"`, which throws outside React
      // Server Components. Tests import them directly, so point it at its empty module.
      "server-only": path.join(root, "node_modules/server-only/empty.js"),
      "@": root,
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
  },
});
