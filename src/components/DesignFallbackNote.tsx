"use client";

import { describeFallback, type DesignFallback } from "@/lib/design";

interface DesignFallbackNoteProps {
  /** The refusal, or `null` when a designed page is rendering. */
  fallback: DesignFallback | null;
}

/**
 * The one line a tab prints under its plain form when its designed page was
 * refused.
 *
 * Said out loud for `<RunResult>`'s reason: a template that silently swapped one
 * rendering for another would teach a reader that the fallback is invisible,
 * and the first time it fired in their own app they would read it as a bug. A
 * method with no design at all prints nothing — that is the rule's first case
 * and its ordinary state.
 */
export function DesignFallbackNote({ fallback }: DesignFallbackNoteProps) {
  const line = fallback === null ? null : describeFallback(fallback);
  if (line === null) return null;
  return (
    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span className="font-medium">Showing the plain form.</span> {line}
    </p>
  );
}
