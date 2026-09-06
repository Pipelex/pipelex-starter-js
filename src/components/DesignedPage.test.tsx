import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createStateStore } from "@json-render/core";
import { specFromJsonl } from "@pipelex/mthds-form/generative";
import { fieldsForContract } from "@pipelex/mthds-form";
import { INPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/extract-entities/contracts";
import { DESIGN } from "@/generated/extract-entities/design";
import { requireContract, requireInputForm } from "@/lib/runInputs";
import { DesignedPage } from "./DesignedPage";

/**
 * What `RenderBoundary` catches, and — the part worth writing down — what it
 * does not.
 *
 * `render_error` is the fallback rule's fifth cause and the only one no gate can
 * reach: `design:check` proves offline that a layout compiles, validates and
 * fits, so a throw at render time is by definition something none of those three
 * questions could have asked. The first two tests pin that such a throw is
 * reported up, so the tab swaps to the plain form and says why.
 *
 * The third pins the boundary's REACH, which is narrower than the composition
 * suggests. json-render wraps every element it renders in an
 * `ElementErrorBoundary` that logs and returns `null`, so a control that throws
 * is dropped from the page and never reaches this boundary at all: the page
 * arrives incomplete, the call to action stays, and the plain form does not take
 * over. The outer boundary is reachable only ABOVE the renderer. That belongs
 * upstream to fix; what belongs here is that it stops being a surprise.
 */

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "extract_entities", "extract_entities");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "extract_entities", "extract_entities");
const FIELDS = fieldsForContract(CONTRACT, DESCRIPTOR);

/** Flipped by the one test that needs the page's own wrapper chain to fail. */
let explodeAboveTheRenderer = false;

vi.mock("@pipelex/mthds-form/generative", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pipelex/mthds-form/generative")>();
  return {
    ...actual,
    GenerativePage: (props: Parameters<typeof actual.GenerativePage>[0]) => {
      if (explodeAboveTheRenderer) throw new Error("the page could not mount");
      return actual.GenerativePage(props);
    },
  };
});

afterEach(() => {
  explodeAboveTheRenderer = false;
  vi.restoreAllMocks();
});

function renderPage(overrides: Partial<Parameters<typeof DesignedPage>[0]> = {}) {
  if (DESIGN === null) throw new Error("extract-entities has no committed design");
  const onRenderError = vi.fn();
  const onRun = vi.fn();
  render(
    <DesignedPage
      design={DESIGN}
      spec={specFromJsonl(DESIGN.jsonl)}
      store={createStateStore({ inputs: { text: "Ada Lovelace, 1843" } })}
      fields={FIELDS}
      idPrefix="extract-entities"
      onRun={onRun}
      onRenderError={onRenderError}
      {...overrides}
    />,
  );
  return { onRenderError, onRun };
}

/** The call to action, by the label the committed layout gives it. */
function cta(): HTMLElement {
  return screen.getByRole("button", { name: "Extract entities" });
}

/**
 * Press it, and let the chain settle.
 *
 * The layout binds two actions to the press — `validateForm`, then `run` — and
 * the kernel walks them asynchronously, so a synchronous assertion right after
 * the click reads the state before `run` was ever reached.
 */
async function press(): Promise<void> {
  fireEvent.click(cta());
  await act(async () => {});
}

describe("DesignedPage", () => {
  it("renders the committed layout and credits what produced it", () => {
    const { onRenderError } = renderPage();
    expect(onRenderError).not.toHaveBeenCalled();
    expect(screen.getByText(/This page was designed by/)).toBeInTheDocument();
    expect(cta()).toBeInTheDocument();
  });

  it("reports a throw above the renderer as a render error, and renders nothing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    explodeAboveTheRenderer = true;

    const { onRenderError } = renderPage();

    expect(onRenderError).toHaveBeenCalledWith("the page could not mount");
    expect(screen.queryByText(/This page was designed by/)).not.toBeInTheDocument();
  });

  it("does NOT see a throw inside a rendered element — json-render swallows it first", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createStateStore({ inputs: { text: "" } });
    const exploding = {
      ...store,
      get(path: string) {
        if (path === "/inputs/text") throw new Error("boom");
        return store.get(path);
      },
    };

    const { onRenderError } = renderPage({ store: exploding });

    // The limitation, asserted rather than wished away: the field is gone, the
    // page is still standing, and the host was never told.
    expect(onRenderError).not.toHaveBeenCalled();
    expect(screen.getByText(/This page was designed by/)).toBeInTheDocument();
  });

  it("starts a run when nothing is in flight", async () => {
    const { onRun } = renderPage({ env: { disabled: false } });
    await press();
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("refuses to start a run while `env.disabled` says one is already going", async () => {
    // The kernel's `Cta` reads nothing from `env`, so it cannot disable itself
    // and stays clickable for the whole run. Without this guard a second press
    // starts a second billed run and the first one's tracking is dropped.
    const { onRun } = renderPage({ env: { disabled: true } });
    await press();
    await press();
    expect(onRun).not.toHaveBeenCalled();
  });
});
