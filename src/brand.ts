import type { BrandManifest } from "@pipelex/mthds-form/generative";

/**
 * The brand a designed page's chrome renders: the app bar's name and logo pair,
 * and the web font the page loads.
 *
 * Data, not code — this is the file to edit when you make this template your
 * own, and `/bootstrap` renames it beside the other template names. The form
 * kernel's own product registry opens every page with an `AppBar` that reads a
 * brand from context, so a page rendered without one loses its bar: json-render
 * catches the throw at the element boundary, drops the bar, and names the cure
 * in the console.
 *
 * **The logo URLs are absolute, and they have to be.** `brandManifestSchema`
 * accepts `http(s)` and nothing else, so a template served from `localhost`
 * cannot point at its own `public/` — a root-relative path is refused before it
 * reaches the `<img>`. That is a deliberate rule about produced content (a
 * manifest has a layout's provenance, so its URLs are checked where it is
 * parsed rather than trusted at the DOM), and the ask to let a host serve its
 * own logo is filed upstream. Until it lands, absolute URLs; the day it does,
 * `public/` is the right home for these two files.
 *
 * A unit test parses this against the kernel's schema, so a typo here fails
 * `make check` rather than an app bar.
 */
export const BRAND: BrandManifest = {
  name: "Pipelex Starter",
  website: "https://pipelex.com/",
  logo: {
    onLight: "https://d2cinlfp2qnig1.cloudfront.net/logo/Pipelex-logo-bot-1119x352.png",
    onDark: "https://pipelex.com/logo.png",
  },
  webfont: { provider: "google-fonts", family: "Inter" },
};
