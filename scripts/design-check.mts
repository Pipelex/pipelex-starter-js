#!/usr/bin/env node
/**
 * CLI entry for `npm run design:check`. The behavior — and its exit code — lives
 * in `scripts/lib/design.mts`, which is importable and therefore testable; this
 * file exists only to be the thing Node runs.
 */
import process from "node:process";

import { runDesignCheck } from "./lib/design.mts";

process.exit(await runDesignCheck());
