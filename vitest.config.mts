import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    // A designed page's brand appends a Google Fonts <link> the way a host puts
    // one in its document head, and happy-dom would fetch it for real — one
    // aborted TLS request per test, reported as a DOMException at teardown.
    // Nothing in a test asserts on a typeface, so the loader is off; the second
    // flag is what keeps it quiet, because a disabled load is otherwise raised
    // as an error and every designed page renders one.
    environmentOptions: {
      happyDOM: {
        settings: { disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
      },
    },
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
      // See the note in vitest.server-only-stub.ts.
      "server-only": path.resolve(__dirname, "./vitest.server-only-stub.ts"),
    },
  },
});
