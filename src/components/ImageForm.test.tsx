import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ImageForm } from "./ImageForm";
import {
  pollGenerateImageRun,
  runGenerateImageBlocking,
  startGenerateImageRun,
} from "@/actions/runGenerateImagePipeline";
import { DESIGN } from "@/generated/generate-image/design";
import { ctaLabelOf, showPlainForm } from "./designedView.fixture";

vi.mock("@/actions/runGenerateImagePipeline", () => ({
  runGenerateImageBlocking: vi.fn(),
  startGenerateImageRun: vi.fn(),
  pollGenerateImageRun: vi.fn(),
}));

const blocking = vi.mocked(runGenerateImageBlocking);
const start = vi.mocked(startGenerateImageRun);
const poll = vi.mocked(pollGenerateImageRun);

beforeEach(() => {
  vi.useFakeTimers();
  blocking.mockReset();
  start.mockReset();
  poll.mockReset();
});
afterEach(() => vi.useRealTimers());

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function submitForm() {
  const form = screen.getByRole("button", { name: /generate image/i }).closest("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

const IMAGE = {
  url: "https://cdn.example/x.png",
  mime_type: "image/png",
};
const USAGE = {
  calls: [
    {
      modelName: "gpt-image-1-mini",
      modelType: "img_gen",
      pipeCode: "generate_image",
      tokensByCategory: null,
      costUsd: 0.02,
    },
  ],
  totalCostUsd: 0.02,
  hasCost: true,
  state: "records" as const,
  assemblyError: null,
};

describe("ImageForm", () => {
  it("durable mode (default): renders the generated image", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll.mockResolvedValueOnce({ ok: true, state: "completed", output: IMAGE, usage: USAGE });

    render(<ImageForm />);
    showPlainForm();
    submitForm();

    await flush();
    // The kernel's image arm paints the file with no storage resolver
    // configured, which is why this template renders a hosted image without
    // wiring `<ResultEnvProvider>`. This payload carries only `url`, so it is
    // the fallback arm; the preference itself is the next test.
    expect(screen.getByRole("img")).toHaveAttribute("src", IMAGE.url);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The action receives the schema-shaped dict, keyed by the contract's own
    // input name. Two slips this catches and nothing else does: sending the
    // raw run-values instead of `toData()`, and seeding under a key the
    // contract does not declare (which ships an empty box and a dead Run
    // button — every other test here submits the form element directly, so a
    // disabled button never fails them).
    expect(start).toHaveBeenCalledWith({
      image_prompt: { text: expect.stringContaining("friendly robot") },
    });
  });

  it("paints the signed public_url, not the storage reference beside it", async () => {
    // The one kernel behaviour this template's docs promise outright — "every
    // file these examples produce paints unaided". It is true only because the
    // file arm prefers `public_url`, and a hosted run returns a `pipelex-storage://`
    // URI as `url`, which resolves nowhere in a browser. Without this case a
    // dependency bump could reverse the preference and every image would go
    // blank with `make all` still green.
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll.mockResolvedValueOnce({
      ok: true,
      state: "completed",
      output: {
        url: "pipelex-storage://org/assets/abc.bin",
        public_url: "https://cdn.example/pub.png",
        mime_type: "image/png",
      },
      usage: USAGE,
    });

    render(<ImageForm />);
    showPlainForm();
    submitForm();

    await flush();
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.example/pub.png");
  });

  it("seeds the prompt under the contract's declared input name", () => {
    render(<ImageForm />);
    showPlainForm();
    const box = screen.getByRole("textbox", { name: /image prompt/i });
    expect((box as HTMLTextAreaElement | HTMLInputElement).value).toContain("friendly robot");
    expect(screen.getByRole("button", { name: /generate image/i })).toBeEnabled();
  });

  it("blocking mode demonstrates the ~30s cap (execute_timeout error)", async () => {
    blocking.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "execute_timeout",
        title: "Pipeline exceeded the ~30s blocking limit",
        message: "The blocking request ran for ~30s before the hosted gateway cut it off.",
        hint: { summary: "Switch this example to Durable mode." },
        details: "PipelineExecuteTimeoutError",
      },
    });

    render(<ImageForm />);
    showPlainForm();
    fireEvent.click(screen.getByRole("radio", { name: "Blocking" }));
    submitForm();

    await flush();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/exceeded the ~30s/i)).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it("surfaces a transport_error when the awaited blocking action rejects", async () => {
    blocking.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<ImageForm />);
    showPlainForm();
    fireEvent.click(screen.getByRole("radio", { name: "Blocking" }));
    submitForm();

    await flush();
    expect(screen.getByText(/Could not reach the server/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
  });
});

describe("ImageForm's designed page", () => {
  const ctaLabel = ctaLabelOf(DESIGN);

  it("has a committed design that this kernel renders", () => {
    // If this fails the tab has quietly fallen back to the plain form, and
    // every assertion below would be testing the wrong view.
    expect(DESIGN).not.toBeNull();
    expect(ctaLabel).not.toBe("");
  });

  it("runs the method from the store's inputs when the call to action is pressed", async () => {
    start.mockResolvedValueOnce({ ok: true, runId: "run-1" });
    poll.mockResolvedValueOnce({ ok: true, state: "completed", output: IMAGE, usage: USAGE });

    render(<ImageForm />);
    fireEvent.click(screen.getByRole("button", { name: ctaLabel }));

    await flush();

    // The seeded sample, deflated through the same contract the plain form
    // deflates through — one store, one wire, whichever view was on screen.
    expect(start).toHaveBeenCalledWith({
      image_prompt: { text: expect.stringContaining("friendly robot") },
    });
  });

  it("refuses a second press while the run it started is still in flight", async () => {
    // The kernel's `Cta` reads nothing from `env`, so it stays clickable for
    // the whole run; the guard is `DesignedPage`'s. Without it each press is
    // another billed run whose tracking the previous one just lost.
    start.mockResolvedValue({ ok: true, runId: "run-1" });
    poll.mockResolvedValue({
      ok: true,
      state: "running",
      status: "RUNNING",
      degraded: false,
      retryAfterSeconds: null,
    });

    render(<ImageForm />);
    const cta = screen.getByRole("button", { name: ctaLabel });
    fireEvent.click(cta);
    await flush();
    fireEvent.click(cta);
    fireEvent.click(cta);
    await flush();

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("shows the same value on the plain form, because both views read one store", () => {
    render(<ImageForm />);
    fireEvent.change(screen.getByLabelText("Image prompt"), {
      target: { value: "A lighthouse at dusk" },
    });
    showPlainForm();
    expect(screen.getByLabelText("Image prompt")).toHaveDisplayValue("A lighthouse at dusk");
  });
});
