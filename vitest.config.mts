import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    // Default glob plus the bootstrap skill's anchor-drift test — `**` does
    // not traverse dot-directories, so .claude/ must be listed explicitly.
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", ".claude/skills/bootstrap/scripts/*.test.mjs"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
