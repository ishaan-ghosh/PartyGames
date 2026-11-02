import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Durable Object wiring smoke tests, run inside workerd by the Cloudflare Vitest plugin.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.local.jsonc" } })],
  test: { include: ["test/worker/**/*.test.ts"] },
});
