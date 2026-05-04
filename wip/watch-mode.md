# Follow-up: `mthds gen --watch`

## Why this exists

v0 requires manually re-running `mthds gen` after every bundle edit. For active bundle authoring this is friction — easy to forget, leads to stale `.types.ts` files in commits. A watch mode tightens the inner loop.

## Goal

`mthds gen --watch [path]` watches `.mthds` files under the path and regenerates corresponding `.types.ts` files on change.

## Open design questions

- **Scope**: watch a single bundle, a `methods/` directory tree, or auto-detect the project root via a `METHODS.toml` / package marker?
- **Debounce**: handle editor save-storms cleanly.
- **Errors**: invalid bundle during edit shouldn't kill the watcher; print the error and keep watching.
- **Integration with framework dev servers**: Next.js / Vite users want `.types.ts` updates to trigger their own HMR. Probably "just works" via filesystem write, but worth confirming on the starter.
- **Library choice**: `chokidar` is the conventional pick; consider whether a smaller dep is justified for a CLI feature.

## Pre-work

- Confirm Phase 7's `mthds gen` has a clean separation between "compute" and "write" (so the watcher can call compute on every change without re-parsing fully when nothing semantic changed).

## Definition of done

- `mthds gen --watch methods/` updates each generated file within ~100ms of save.
- Documented in `mthds-js/README.md` and the starter's `Makefile` (e.g. a `make codegen-watch` target).
