import { MthdsApiClient } from "mthds";

let cached: MthdsApiClient | null = null;

/**
 * Returns a process-wide MthdsApiClient. The client reads PIPELEX_API_KEY and
 * PIPELEX_API_URL from the environment if not passed explicitly.
 */
export function getPipelexClient(): MthdsApiClient {
  if (!cached) {
    cached = new MthdsApiClient();
  }
  return cached;
}
