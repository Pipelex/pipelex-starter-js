import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunStatus } from "./RunStatus";

describe("RunStatus", () => {
  it("renders a polite live status region", () => {
    render(<RunStatus status="RUNNING" elapsedMs={0} health={null} />);
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("shows a friendly label for a durable status", () => {
    render(<RunStatus status="PENDING" elapsedMs={0} health={null} />);
    expect(screen.getByText(/Queued/)).toBeInTheDocument();
  });

  it("maps RUNNING to 'Running' and shows elapsed seconds", () => {
    render(<RunStatus status="RUNNING" elapsedMs={2300} health={null} />);
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.getByText(/2\.3s/)).toBeInTheDocument();
  });

  it("shows a spinner + elapsed only when status is null (blocking mode)", () => {
    render(<RunStatus status={null} elapsedMs={1000} health={null} />);
    // No durable status label; the generic "Running…" + elapsed is shown.
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0s/)).toBeInTheDocument();
  });

  it("hides the ticking elapsed counter from assistive tech", () => {
    // The counter updates every 250ms inside the polite live region; it must be
    // aria-hidden so screen readers only announce meaningful status changes.
    render(<RunStatus status="RUNNING" elapsedMs={2300} health={null} />);
    expect(screen.getByText(/2\.3s/)).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a reassuring, cause-specific note when the server is reconnecting", () => {
    render(<RunStatus status="RUNNING" elapsedMs={0} health="reconnecting" />);
    // Reassures (run still going) and never uses the alarming word "degraded".
    expect(screen.getByText(/reconnecting to the run tracker/i)).toBeInTheDocument();
    expect(screen.getByText(/still going/i)).toBeInTheDocument();
    expect(screen.queryByText(/degraded/i)).not.toBeInTheDocument();
  });

  it("shows a distinct note for a client-side retry blip", () => {
    render(<RunStatus status="RUNNING" elapsedMs={0} health="retrying" />);
    expect(screen.getByText(/network hiccup/i)).toBeInTheDocument();
    expect(screen.getByText(/still going/i)).toBeInTheDocument();
  });

  it("omits the note when polling cleanly", () => {
    render(<RunStatus status="RUNNING" elapsedMs={0} health={null} />);
    expect(screen.queryByText(/still going/i)).not.toBeInTheDocument();
  });
});
