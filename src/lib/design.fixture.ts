import type { RunField } from "@pipelex/mthds-form";
import { PROMPT_HASH, specToJsonl } from "@pipelex/mthds-form/generative";
import type { MethodDesign } from "@/lib/design";

/**
 * A committed layout for the tests, and the descriptor it was written for.
 *
 * Test-only — nothing in the app imports it. It is hand-written rather than
 * produced, which is the one place in this repo where that is right: a test
 * about the fallback rule needs a layout it can break on purpose, one cause at
 * a time, and a real produced design is a moving target the day it is
 * re-produced. Everything the app actually renders comes from `npm run design`.
 *
 * It is deliberately the smallest page the catalog accepts: the bar, the hero,
 * a workspace of one section beside a rail with the one call to action, and the
 * single input handed back to the kernel through `MthdsField`.
 */

export const DEMO_FIELDS: RunField[] = [
  {
    kind: "prose",
    name: "text",
    concept_ref: "native.Text",
    description: "A text",
    required: true,
  } as RunField,
];

const DEMO_SPEC = {
  root: "page",
  elements: {
    page: { type: "Stack", props: {}, children: ["bar", "hero", "work"] },
    bar: { type: "AppBar", props: { app: "Demo", links: null, tag: "demo" } },
    hero: { type: "Hero", props: { headline: "Say something", lede: null, eyebrow: null } },
    work: { type: "Workspace", props: { rail: "right" }, children: ["main", "rail"] },
    main: { type: "Stack", props: {}, children: ["sec"] },
    sec: {
      type: "Section",
      props: { number: "01", title: "Your text", lede: null },
      children: ["field"],
    },
    field: { type: "MthdsField", props: { path: "/inputs/text" } },
    rail: { type: "Rail", props: { title: "Run" }, children: ["cta"] },
    cta: { type: "Cta", props: { label: "Run it" }, on: { press: { action: "run" } } },
  },
  // `specToJsonl` takes the compiled shape; the cast is the fixture admitting it
  // is written as a spec rather than replayed from a producer's patch lines.
} as unknown as Parameters<typeof specToJsonl>[0];

export const DEMO_JSONL = specToJsonl(DEMO_SPEC);

/** The fixture as a `MethodDesign`, with any field overridden to break one gate. */
export function demoDesign(overrides: Partial<MethodDesign> = {}): MethodDesign {
  return {
    pipeRef: "demo.demo",
    producer: "claude-code-session",
    model: "test",
    promptHash: PROMPT_HASH,
    date: "2026-09-06",
    jsonl: DEMO_JSONL,
    ...overrides,
  };
}
