import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ImageForm } from "./ImageForm";
import {
  pollGenerateImageRun,
  runGenerateImageBlocking,
  startGenerateImageRun,
} from "@/actions/runGenerateImagePipeline";

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
  const form = screen.getByLabelText(/image prompt/i).closest("form");
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
    submitForm();

    await flush();
    expect(screen.getByRole("img", { name: /generated image/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("radio", { name: "Blocking" }));
    submitForm();

    await flush();
    expect(screen.getByText(/Could not reach the server/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
  });
});
