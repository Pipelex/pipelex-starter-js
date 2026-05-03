import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntityResult } from "./EntityResult";

describe("EntityResult", () => {
  it("renders all three entity categories", () => {
    render(
      <EntityResult
        entities={{
          people: ["Tim Cook"],
          orgs: ["Apple"],
          dates: ["March 5th, 2026"],
        }}
      />,
    );
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Organizations")).toBeInTheDocument();
    expect(screen.getByText("Dates")).toBeInTheDocument();
    expect(screen.getByText("Tim Cook")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("March 5th, 2026")).toBeInTheDocument();
  });

  it("renders 'None' for empty categories", () => {
    render(<EntityResult entities={{ people: [], orgs: [], dates: [] }} />);
    expect(screen.getAllByText("None")).toHaveLength(3);
  });
});
