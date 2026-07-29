import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    environment: "node",
    // Makes an un-injected fetch fail loudly instead of silently hitting prod.
    setupFiles: ["./__tests__/setup.ts"],
  },
});
