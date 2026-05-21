/**
 * Read a browser `File` into a base64 data URL (`data:<mime>;base64,<...>`).
 *
 * This is the single place a `File` object is touched. Server Actions only
 * ever receive the resulting string — `File`/`Blob` are not serializable
 * across the server→client boundary. The action then validates the data URL
 * and builds the Pipelex input envelope (see `@/lib/fileEncoding`).
 *
 * Lives in `src/lib/` as a deliberate client-side exception, like
 * `classifyTransportError` in `errors.ts`.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("FileReader did not return a string"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
