import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EntityForm } from "./EntityForm";
import { runHelloPipeline } from "@/actions/runHelloPipeline";

vi.mock("@/actions/runHelloPipeline", () => ({
  runHelloPipeline: vi.fn(),
}));

const mockedAction = vi.mocked(runHelloPipeline);

function submitForm() {
  const form = screen.getByLabelText(/input text/i).closest("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

describe("EntityForm", () => {
  beforeEach(() => {
    mockedAction.mockReset();
  });

  it("renders extracted entities on success", async () => {
    mockedAction.mockResolvedValueOnce({
      ok: true,
      entities: { people: ["Tim Cook"], orgs: ["Apple"], dates: ["2026-03-05"] },
    });

    render(<EntityForm />);
    submitForm();

    expect(await screen.findByText("Tim Cook")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the structured error when the action returns ok:false", async () => {
    mockedAction.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "auth_missing",
        title: "Pipelex API key missing",
        message: "no key configured",
        details: "ApiResponseError: HTTP 401",
      },
    });

    render(<EntityForm />);
    submitForm();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Pipelex API key missing")).toBeInTheDocument();
  });

  it("surfaces a transport_error when the awaited action rejects", async () => {
    // Regression guard: without the client-side try/catch in EntityForm, a
    // rejected await inside startTransition bubbles to React's error boundary
    // and bypasses <ErrorDisplay> entirely.
    mockedAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<EntityForm />);
    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the server/i)).toBeInTheDocument();
    // The original failure must be carried through to "Technical details".
    expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
  });
});
