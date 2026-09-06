import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { INPUTS_ROOT, pathFromDomId, segmentsUnder } from "@pipelex/mthds-form/generative";
import { useFileInputs } from "@/hooks/useFileInputs";

/** The same inverse a form with a file input writes, over a page prefix. */
const ID_PREFIX = "demo";
function inputPathOf(id: string): string[] | undefined {
  const pointer = pathFromDomId(ID_PREFIX, id);
  if (pointer === undefined) return id.split(".");
  return segmentsUnder(INPUTS_ROOT, pointer);
}

function pdf(name = "a.pdf") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
}

describe("useFileInputs pathOf", () => {
  it("writes at the dotted path by default — the plain form's id IS the path", async () => {
    const setValues = vi.fn((update: (c: Record<string, unknown>) => Record<string, unknown>) =>
      update({}),
    );
    const { result } = renderHook(() => useFileInputs({ setValues }));

    await act(() => result.current.dropFile("document", pdf()));

    const written = setValues.mock.results.at(-1)?.value as Record<string, unknown>;
    expect(written.document).toMatchObject({ filename: "a.pdf" });
  });

  it("writes at the mapped path when a designed page reports its minted id", async () => {
    // `MthdsField` mints its id from the store pointer, so the write has to go
    // back through the inverse. A file landing at a plausible-looking wrong path
    // is the one failure this seam must never have.
    const setValues = vi.fn((update: (c: Record<string, unknown>) => Record<string, unknown>) =>
      update({}),
    );
    const { result } = renderHook(() => useFileInputs({ setValues, pathOf: inputPathOf }));

    await act(() => result.current.dropFile("demo-inputs-document", pdf()));

    const written = setValues.mock.results.at(-1)?.value as Record<string, unknown>;
    expect(written.document).toMatchObject({ filename: "a.pdf" });
  });

  it("keeps the busy set keyed by the id the kernel reported, never by the path", async () => {
    // `uploadingIds` is compared against the id the control emitted, so mapping
    // it would leave the control writable while its value was still resolving.
    const setValues = vi.fn(() => ({}));
    const { result } = renderHook(() => useFileInputs({ setValues, pathOf: inputPathOf }));

    const busy: string[][] = [];
    act(() => {
      result.current.markBusy("demo-inputs-document", true);
    });
    busy.push([...result.current.encodingIds]);
    expect(busy[0]).toEqual(["demo-inputs-document"]);
  });

  it("refuses loudly rather than writing when an id maps to no input path", async () => {
    const setValues = vi.fn(() => ({}));
    const { result } = renderHook(() => useFileInputs({ setValues, pathOf: inputPathOf }));

    // A designed-page id outside `/inputs` — the layout's own scratch state.
    await act(() => result.current.dropFile("demo-ui-showDetails", pdf()));

    expect(setValues).not.toHaveBeenCalled();
    expect(result.current.fileError).not.toBeNull();
    expect(result.current.fileError?.kind).toBe("bad_request");
    expect(result.current.fileError?.details).toContain("demo-ui-showDetails");
  });
});
