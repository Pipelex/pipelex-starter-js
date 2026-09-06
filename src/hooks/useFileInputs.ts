"use client";

import { useCallback, useState } from "react";
import { setValueAtPath } from "@pipelex/mthds-form";
import { fileToDataUrl } from "@/lib/clientFile";
import { classifyTransportError, type PipelineError } from "@/lib/errors";
import {
  MAX_PDF_BYTES,
  fileInputErrorToPipelineError,
  fileTooLargeError,
} from "@/lib/fileEncoding";

/**
 * The host side of the form kernel's file seam, in one hook.
 *
 * The kernel never uploads: a `DocumentField` or `ImageField` fires
 * `env.onDropFile(id, file)` and waits, and the host is expected to encode the
 * bytes and write a `FileValue` (`{url, filename}`) back at the field's dotted
 * path. That is a small amount of code with several ways to get it subtly
 * wrong, and it is the same code for every method that declares a file input —
 * so `make add-method` can hand a scaffolded form a hook instead of a hundred
 * lines it would have to emit as a string.
 *
 * The three rules it keeps, each of which is a bug when dropped:
 *
 *  - **Clear before every await.** Every path that is about to replace a
 *    selection un-sets the value *before* its first await, so the form's value
 *    is only ever a successfully encoded file: a replacement still in flight,
 *    or one that fails, leaves nothing behind to submit by accident.
 *  - **Stay busy for the whole operation, not just the encode.** While an id is
 *    in `encodingIds` the kernel shuts every door into that value — the
 *    dropzone, the "paste a URL instead" toggle, the URL input behind it — and
 *    shows a spinner. A window where the field is writable while an older
 *    selection is still resolving is a window where the older one lands last
 *    and silently replaces the newer.
 *  - **Check the size before encoding.** Purely to save the work: base64
 *    inflates a file by about a third, and past this cap the payload would not
 *    fit the Server Action body limit anyway. The Server Action re-checks the
 *    same exported constant, and that is the actual gate — this is an early
 *    exit, not a second rule.
 *
 * `encodingIds` is a set rather than a refcount, which matters for a caller
 * that nests one `dropFile` inside its own busy span (the PDF example's sample
 * shortcut does): the inner release frees the field while the outer span is
 * still open. That is safe only because nothing awaits after the inner call
 * returns.
 */
export interface UseFileInputsOptions {
  /** Write the encoded `FileValue` into the form's values at a dotted path. */
  setValues: (update: (current: Record<string, unknown>) => Record<string, unknown>) => void;
  /**
   * Run before a new selection is accepted — the PDF example clears the
   * previous run so only the new selection shows. Called before any await.
   */
  onSelectionStart?: () => void;
  /**
   * Last chance to fix a `File` the browser described badly, before it is read.
   * The PDF example re-wraps a `.pdf` whose `file.type` is empty. This is
   * *encoding*, not validation — the server still checks the MIME it receives.
   */
  prepareFile?: (file: File) => File;
  /** The size cap, in bytes. Defaults to the Server Action body limit's margin. */
  maxBytes?: number;
  /**
   * The value path an id names, when it is not the dotted path itself.
   *
   * On a plain form the kernel's id IS the path — `document`, or
   * `invoice.attachment` for a file nested in a structure — so the default
   * splits it and nothing else happens. On a designed page the id was minted by
   * the layout's escape hatch from a store pointer (`gen-inputs-document`), and
   * the inverse is the kernel's own `pathFromDomId`. The busy set is deliberately
   * NOT mapped: `uploadingIds` is compared against the id the control reported,
   * so it must stay the id, whichever page rendered it.
   *
   * Returning `undefined` refuses the write and reports it — a file written at a
   * plausible-looking wrong path is the one failure this seam must never have.
   */
  pathOf?: (id: string) => string[] | undefined;
}

export interface UseFileInputs {
  /** Hand straight to `<RunInputsForm env={{ onDropFile }}>`. */
  dropFile: (id: string, file: File) => Promise<void>;
  /** Hand straight to `<RunInputsForm env={{ uploadingIds }}>`. */
  encodingIds: ReadonlySet<string>;
  /**
   * A rejected selection, or a `FileReader` failure. Separate from the run's
   * own error because it happens *before* a run, so there is no `useRun` error
   * to carry it.
   */
  fileError: PipelineError | null;
  /** Clear the rejection — a value the user has already fixed keeps no alert. */
  clearError: () => void;
  /** Hold a field busy across an operation of the host's own, such as a fetch. */
  markBusy: (id: string, busy: boolean) => void;
  /** Report a failure of such an operation as this hook's own file error. */
  reportError: (err: unknown) => void;
  /** Un-select the file at `id`, before an await that will replace it. */
  clearFile: (id: string) => void;
}

const NO_UPLOADS: ReadonlySet<string> = new Set<string>();

/** The plain form's id: the dotted value path itself. */
const DOTTED_PATH = (id: string) => id.split(".");

export function useFileInputs({
  setValues,
  onSelectionStart,
  prepareFile,
  maxBytes = MAX_PDF_BYTES,
  pathOf = DOTTED_PATH,
}: UseFileInputsOptions): UseFileInputs {
  const [fileError, setFileError] = useState<PipelineError | null>(null);
  const [encodingIds, setEncodingIds] = useState<ReadonlySet<string>>(NO_UPLOADS);

  const clearError = useCallback(() => setFileError(null), []);

  const clearFile = useCallback(
    (id: string) => {
      const path = pathOf(id);
      if (!path) return;
      setValues((current) => setValueAtPath(current, path, undefined));
    },
    [pathOf, setValues],
  );

  const markBusy = useCallback((id: string, busy: boolean) => {
    setEncodingIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const reportError = useCallback((err: unknown) => setFileError(classifyTransportError(err)), []);

  const dropFile = useCallback(
    async (id: string, file: File) => {
      setFileError(null);
      const path = pathOf(id);
      if (!path) {
        // Built inline rather than classified: nothing was thrown and nothing
        // was asked of a server. This is a wiring fault in the host — the id
        // the control reported names no input — and it is reported instead of
        // guessed at, because a file written at a plausible-looking wrong path
        // is the one failure this seam must never have.
        setFileError({
          kind: "bad_request",
          title: "That file has nowhere to go",
          message:
            "The form could not work out which input the file was dropped on, so nothing " +
            "was written. Nothing was sent to the Pipelex API.",
          details:
            `No input path for the field id '${id}'. On a designed page the id is minted ` +
            "from the layout's store pointer, so the form must map it back with " +
            "`pathFromDomId` — see `pathOf` in useFileInputs.",
        });
        return;
      }
      onSelectionStart?.();
      clearFile(id); // before the size check and before the encode
      if (file.size > maxBytes) {
        setFileError(
          fileInputErrorToPipelineError(fileTooLargeError(file.size, maxBytes), file.name),
        );
        return;
      }
      markBusy(id, true);
      try {
        const url = await fileToDataUrl(prepareFile ? prepareFile(file) : file);
        setValues((current) => setValueAtPath(current, path, { url, filename: file.name }));
      } catch (err) {
        setFileError(classifyTransportError(err));
      } finally {
        markBusy(id, false);
      }
    },
    [pathOf, onSelectionStart, clearFile, maxBytes, markBusy, prepareFile, setValues],
  );

  return {
    dropFile,
    encodingIds,
    fileError,
    clearError,
    markBusy,
    reportError,
    clearFile,
  };
}
