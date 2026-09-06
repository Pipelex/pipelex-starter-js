"use client";

import { useState } from "react";
import { INPUTS_ROOT, pathFromDomId, segmentsUnder } from "@pipelex/mthds-form/generative";
import { humanizeFieldName } from "@pipelex/mthds-form/react";
import {
  pollSummarizePdfRun,
  runSummarizePdfBlocking,
  startSummarizePdfRun,
} from "@/actions/runSummarizePdfPipeline";
import { DEFAULT_EXECUTION_MODE, type ExecutionMode } from "@/config";
import { INPUT_FORM, OUTPUT_FORM, PIPE_IO_CONTRACTS } from "@/generated/summarize-pdf/contracts";
import { DESIGN } from "@/generated/summarize-pdf/design";
import { useFileInputs } from "@/hooks/useFileInputs";
import { useRun } from "@/hooks/useRun";
import { useRunInputs } from "@/hooks/useRunInputs";
import type { DesignFallback } from "@/lib/design";
import { requireResultField } from "@/lib/resultField";
import { requireContract, requireInputForm } from "@/lib/runInputs";
import { CostReport } from "./CostReport";
import { DesignedPage } from "./DesignedPage";
import { DesignFallbackNote } from "./DesignFallbackNote";
import { ErrorDisplay } from "./ErrorDisplay";
import { ModeToggle } from "./ModeToggle";
import { RunInputsForm } from "./RunInputsForm";
import { RunResult } from "./RunResult";
import { RunStatus } from "./RunStatus";
import { ViewToggle, type InputView } from "./ViewToggle";

const CONTRACT = requireContract(PIPE_IO_CONTRACTS, "summarize_pdf", "summarize_pdf");
const DESCRIPTOR = requireInputForm(INPUT_FORM, "summarize_pdf", "summarize_pdf");
const RESULT_FIELD = requireResultField(OUTPUT_FORM, CONTRACT, "summarize_pdf", "summarize_pdf");
const RESULT_NAME = "document_summary";
/** Prefixes the DOM ids the designed page's escape hatches mint. */
const ID_PREFIX = "summarize-pdf";

const SAMPLE_PDF_PATH = "/sample-invoice.pdf";
/** The input the sample PDF fills. Like a seeded sample text, a demo shortcut
 *  names the input it is a sample *of* — the form's structure still does not. */
const DOCUMENT_INPUT = "document";

/**
 * The id inverse — the one piece of real host code the designed view needs.
 *
 * On the plain form the kernel's id IS the dotted value path. On a designed page
 * the file control was reached through the layout's `MthdsField` hatch, which
 * mints its id from the store pointer it was given
 * (`summarize-pdf-inputs-document`), so the host must map it back before it
 * writes. `pathFromDomId` is the kernel's own inverse, kept beside the minting
 * function so the two cannot drift; `segmentsUnder` turns the pointer it returns
 * into the dotted segments `setValueAtPath` writes at.
 *
 * One hook serves both views, because the form is mounted once and the toggle
 * only swaps what it renders — so this has to answer for both spellings. A
 * plain-form id can never collide with the prefixed one: an input name is a
 * snake_case identifier and cannot contain the `-` this prefix ends with.
 */
function inputPathOf(id: string): string[] | undefined {
  const pointer = pathFromDomId(ID_PREFIX, id);
  if (pointer === undefined) return id.split(".");
  return segmentsUnder(INPUTS_ROOT, pointer);
}

/**
 * The kernel previews `http(s):`, `data:` and `blob:` URLs directly — the
 * sample shortcut's `data:` URL included. Anything else it asks the host to
 * resolve first, and the path that reaches it here is a
 * `pipelex-storage://…/x.pdf` pasted through the control's own "paste a URL
 * instead". This template has nothing to sign such a reference with, so it
 * hands it straight back.
 *
 * What that buys is not a preview — the kernel judges a resolver's answer by
 * the same URL gate it judges a payload by, and a storage URI is refused there
 * as it is everywhere else, so the panel shows "nothing to show". What it buys
 * is the difference between that and a spinner: with no resolver at all the
 * kernel has a reference and no answer about it, which is a load still in
 * flight, and it spins forever. An identity resolver is the host saying "I have
 * no better URL than this one", which is an answer. A real host would exchange
 * the storage URI for a signed web URL here, and then the preview paints.
 */
async function resolvePreviewUrl(url: string): Promise<string> {
  return url;
}

/**
 * Some drag-drop sources and Windows configurations hand a valid PDF over with
 * an empty `file.type`, and `FileReader` then writes that emptiness into the
 * data URL — which the server's MIME gate rejects. Re-wrap those so the encoded
 * URL carries `application/pdf`.
 *
 * This is *encoding*, not validation: the extension test is what keeps it from
 * stamping "PDF" on something that is not one, and the server still checks the
 * MIME it receives.
 */
function withPdfMime(file: File): File {
  if (file.type || !file.name.toLowerCase().endsWith(".pdf")) return file;
  return new File([file], file.name, { type: "application/pdf" });
}

export function PdfForm() {
  const { fields, values, setValues, ready, toData, design, store } = useRunInputs(
    CONTRACT,
    DESCRIPTOR,
    undefined,
    DESIGN,
  );
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const [view, setView] = useState<InputView>("designed");
  const [renderError, setRenderError] = useState<string | null>(null);

  const { state, run, reset } = useRun({
    mode,
    blocking: runSummarizePdfBlocking,
    start: startSummarizePdfRun,
    poll: pollSummarizePdfRun,
  });

  // The host side of the kernel's file seam — the encode, the busy set the
  // kernel reads as `uploadingIds`, the clear-before-await discipline, and on a
  // designed page the id inverse above. Shared with every scaffolded form that
  // declares a file input; the two other options are this example's own: clear
  // the previous run when a new file is selected, and re-wrap a `.pdf` the
  // browser described with no MIME type.
  const { dropFile, encodingIds, fileError, clearError, markBusy, reportError, clearFile } =
    useFileInputs({
      setValues,
      onSelectionStart: reset,
      prepareFile: withPdfMime,
      pathOf: inputPathOf,
    });

  const running = state.phase === "running";
  const resolving = encodingIds.size > 0;

  const fallback: DesignFallback | null =
    renderError !== null
      ? { cause: "render_error", message: renderError }
      : design.ok
        ? null
        : design.fallback;
  const designed = fallback === null && design.ok && store !== null;

  async function handleUseSample() {
    clearError();
    reset();
    // Clear here too, not just in the hook: this path awaits a network round
    // trip first, and a slow or failing fetch would otherwise leave the
    // previous PDF selected and submittable the whole time.
    clearFile(DOCUMENT_INPUT);
    // Busy for the fetch as well as the encode. Without this the field is
    // writable while the sample is still downloading, so a PDF the user picks
    // meanwhile would be overwritten when the older sample request lands.
    markBusy(DOCUMENT_INPUT, true);
    try {
      const res = await fetch(SAMPLE_PDF_PATH);
      if (!res.ok) throw new Error(`Could not load the sample PDF (HTTP ${res.status})`);
      const blob = await res.blob();
      // Run the sample through the exact same seam as a real drop.
      await dropFile(
        DOCUMENT_INPUT,
        new File([blob], "sample-invoice.pdf", { type: "application/pdf" }),
      );
    } catch (err) {
      reportError(err);
    } finally {
      markBusy(DOCUMENT_INPUT, false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();
    run(toData());
  }

  const outcome =
    state.phase === "idle" && !fileError ? null : (
      <>
        {running && (
          <RunStatus status={state.status} elapsedMs={state.elapsedMs} health={state.health} />
        )}
        {fileError && <ErrorDisplay error={fileError} />}
        {!fileError && state.phase === "error" && <ErrorDisplay error={state.error} />}
        {state.phase === "done" && (
          <>
            <RunResult field={RESULT_FIELD} value={state.output} name={RESULT_NAME} />
            <CostReport usage={state.usage} />
          </>
        )}
      </>
    );

  return (
    <div className="space-y-6">
      {/* App chrome, above whichever view is on screen. The sample shortcut sits
          here rather than inside the plain form so it keeps working on the
          designed page — it writes through the same file seam either way. It
          holds itself to the rule the kernel applies to its own controls: no
          writes while the value is still resolving. */}
      <div className="flex flex-wrap items-start gap-4">
        <ModeToggle value={mode} onChange={setMode} disabled={running} />
        {design.ok && renderError === null && (
          <ViewToggle value={view} onChange={setView} disabled={running} />
        )}
        <button
          type="button"
          onClick={handleUseSample}
          disabled={running || resolving}
          className="self-center text-xs font-medium text-blue-700 underline disabled:opacity-50"
        >
          Use sample PDF
        </button>
      </div>

      {designed && view === "designed" ? (
        <DesignedPage
          design={design.design}
          spec={design.spec}
          store={store}
          fields={fields}
          idPrefix={ID_PREFIX}
          // `disabled` covers the whole page while a file is resolving, where
          // the plain view narrows that to the one field through `uploadingIds`.
          // The kernel compares that set against the id its control reported,
          // and on a designed page that id is minted from the store pointer by a
          // function the entry does not export — so the host cannot name the one
          // field and closes the window on all of them instead. Exporting the
          // forward `domIdFor` is filed upstream; this line goes when it lands.
          env={{
            onDropFile: dropFile,
            uploadingIds: encodingIds,
            resolveUrl: resolvePreviewUrl,
            disabled: running || resolving,
          }}
          onRun={() => run(toData())}
          result={outcome}
          resultTitle={humanizeFieldName(RESULT_NAME)}
          onRenderError={setRenderError}
        />
      ) : (
        <>
          <form onSubmit={handleSubmit} className="space-y-4">
            <RunInputsForm
              fields={fields}
              values={values}
              onValuesChange={(next) => {
                // A rejection belongs to the value that caused it. The kernel's
                // "paste a URL instead" writes straight through this setter without
                // touching `acceptFile`, so without clearing here a "File is too
                // large" alert sits under a field the user has already fixed.
                clearError();
                setValues(next);
              }}
              disabled={running}
              env={{
                onDropFile: dropFile,
                uploadingIds: encodingIds,
                resolveUrl: resolvePreviewUrl,
              }}
            />
            <button
              type="submit"
              disabled={running || !ready}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Summarizing…" : "Summarize PDF"}
            </button>
          </form>
          <DesignFallbackNote fallback={fallback} />
          {outcome}
        </>
      )}
    </div>
  );
}
