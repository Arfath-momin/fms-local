import { defineConfig } from "vitest/config";

// Node environment, not jsdom: everything under test here is money arithmetic
// and SQL, none of it touches a DOM.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // import.meta.dirname, not __dirname: this config is ESM (.mts).
      "@": new URL("./src", import.meta.url).pathname,
      // `server-only` exists to make a build fail if server code is pulled
      // into a client bundle. A Node test runner is neither, and the modules
      // under test — the ledger and the reports — are exactly the ones that
      // import it, so it is stubbed rather than worked around per test.
      "server-only": new URL("./tests/server-only-stub.ts", import.meta.url)
        .pathname,
    },
  },
});
