import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeToggle } from "./ModeToggle";

describe("ModeToggle", () => {
  it("renders a radiogroup with both modes and marks the selected one", () => {
    render(<ModeToggle value="durable" onChange={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: /execution mode/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Blocking" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("radio", { name: /Durable/ })).toHaveAttribute("aria-checked", "true");
  });

  it("fires onChange with the clicked mode", () => {
    const onChange = vi.fn();
    render(<ModeToggle value="durable" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Blocking" }));
    expect(onChange).toHaveBeenCalledWith("blocking");
  });

  it("respects disabled", () => {
    const onChange = vi.fn();
    render(<ModeToggle value="durable" onChange={onChange} disabled />);
    const blocking = screen.getByRole("radio", { name: "Blocking" });
    expect(blocking).toBeDisabled();
    fireEvent.click(blocking);
    expect(onChange).not.toHaveBeenCalled();
  });
});
