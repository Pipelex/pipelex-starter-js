import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageForm } from "./ImageForm";
import { runGenerateImagePipeline } from "@/actions/runGenerateImagePipeline";

vi.mock("@/actions/runGenerateImagePipeline", () => ({
  runGenerateImagePipeline: vi.fn(),
}));

const mockedAction = vi.mocked(runGenerateImagePipeline);

function submitForm() {
  const form = screen.getByLabelText(/image prompt/i).closest("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

describe("ImageForm", () => {
  beforeEach(() => {
    mockedAction.mockReset();
  });

  it("renders the generated image on success", async () => {
    mockedAction.mockResolvedValueOnce({
      ok: true,
      image: {
        url: "https://cdn.example/x.png",
        publicUrl: null,
        mimeType: "image/png",
        caption: null,
      },
    });

    render(<ImageForm />);
    submitForm();

    expect(await screen.findByRole("img", { name: /generated image/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the structured error when the action returns ok:false", async () => {
    mockedAction.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "server_error",
        title: "Image model unavailable",
        message: "no backend",
        details: "ApiResponseError: HTTP 500",
      },
    });

    render(<ImageForm />);
    submitForm();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Image model unavailable")).toBeInTheDocument();
  });

  it("surfaces a transport_error when the awaited action rejects", async () => {
    // Regression guard, mirroring EntityForm: a rejected await inside
    // startTransition must route through <ErrorDisplay>, not React's boundary.
    mockedAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<ImageForm />);
    submitForm();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the server/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
  });
});
