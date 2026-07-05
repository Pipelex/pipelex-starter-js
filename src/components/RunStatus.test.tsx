import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunStatus } from "./RunStatus";

describe("RunStatus", () => {
  it("renders a polite live status region", () => {
    render(<RunStatus status="RUNNING" elapsedMs={0} degraded={false} />);
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("shows a friendly label for a durable status", () => {
    render(<RunStatus status="PENDING" elapsedMs={0} degraded={false} />);
    expect(screen.getByText(/Queued/)).toBeInTheDocument();
  });

  it("maps RUNNING to 'Running' and shows elapsed seconds", () => {
    render(<RunStatus status="RUNNING" elapsedMs={2300} degraded={false} />);
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.getByText(/2\.3s/)).toBeInTheDocument();
  });

  it("shows a spinner + elapsed only when status is null (blocking mode)", () => {
    render(<RunStatus status={null} elapsedMs={1000} degraded={false} />);
    // No durable status label; the generic "Running…" + elapsed is shown.
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0s/)).toBeInTheDocument();
  });

  it("hides the ticking elapsed counter from assistive tech", () => {
    // The counter updates every 250ms inside the polite live region; it must be
    // aria-hidden so screen readers only announce meaningful status changes.
    render(<RunStatus status="RUNNING" elapsedMs={2300} degraded={false} />);
    expect(screen.getByText(/2\.3s/)).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a degraded note when degraded", () => {
    render(<RunStatus status="RUNNING" elapsedMs={0} degraded={true} />);
    expect(screen.getByText(/degraded/i)).toBeInTheDocument();
  });

  it("omits the degraded note when not degraded", () => {
    render(<RunStatus status="RUNNING" elapsedMs={0} degraded={false} />);
    expect(screen.queryByText(/degraded/i)).not.toBeInTheDocument();
  });
});
