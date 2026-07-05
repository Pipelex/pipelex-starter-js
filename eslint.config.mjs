import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    // Route diagnostics through structured errors (classifyPipelineError),
    // not stray console writes. Mirrors mthds-js / mthds-ui.
    rules: {
      "no-console": "error",
    },
  },
  {
    // e2e specs may log for debugging — same carve-out the siblings give tests.
    files: ["e2e/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Build/tooling files (root configs, skill CLI scripts) write to the
    // terminal by design — there is no classifyPipelineError there, console
    // IS the output channel. Mirrors mthds-js's CLI-entrypoint carve-out.
    files: ["*.config.{ts,mts,cts,js,mjs,cjs}", ".claude/skills/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
]);

export default eslintConfig;
