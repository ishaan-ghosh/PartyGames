import react from "@vitejs/plugin-react";
import { networkInterfaces } from "node:os";
import { defineConfig } from "vite";

function lanOrigin(port: number): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return `http://${i.address}:${port}`;
  }
  return "";
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: { __LAN_ORIGIN__: JSON.stringify(command === "serve" ? lanOrigin(5173) : "") },
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/parties": { target: "http://localhost:8787", ws: true },
      "/api": { target: "http://localhost:8787" },
    },
  },
  test: { include: ["src/**/*.test.ts"] },
}));
