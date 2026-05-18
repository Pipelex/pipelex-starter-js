import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PdfSummaryResult } from "./PdfSummaryResult";

describe("PdfSummaryResult", () => {
  it("renders the title, doc type, and key points", () => {
    render(
      <PdfSummaryResult
        summary={{
          title: "Q1 Revenue Report",
          docType: "report",
          keyPoints: ["Revenue up 12%", "Costs flat"],
        }}
      />,
    );
    expect(screen.getByText("Q1 Revenue Report")).toBeInTheDocument();
    expect(screen.getByText("report")).toBeInTheDocument();
    expect(screen.getByText("Revenue up 12%")).toBeInTheDocument();
    expect(screen.getByText("Costs flat")).toBeInTheDocument();
  });

  it("renders 'None' when there are no key points", () => {
    render(<PdfSummaryResult summary={{ title: "Memo", docType: "memo", keyPoints: [] }} />);
    expect(screen.getByText("None")).toBeInTheDocument();
  });
});
