# Chrome lineage: where this gallery's shared code comes from

This repository is the gallery: an app that presents several demo methods as tabs. [`pipelex-method-apps`](https://github.com/Pipelex/pipelex-method-apps) holds the demo-free template that was extracted from it, `webapp-js/`, which is the app `/pipelex-scaffold` creates for one method. The two share the code every method needs, which this document calls the chrome. **The template holds the reference copy of the chrome, and this gallery keeps a copy by hand.** No tool keeps the two in sync.

## The rule

- **A chrome fix lands in the template first.** It then reaches this gallery as a port, made deliberately, with the gallery's own differences (below) kept.
- **Before fixing the chrome here, look at the template.** If the template already carries the fix, port it rather than writing a second one, so that the two copies stay easy to compare.
- **A chrome fix made here first needs its twin in the template.** A defect is often found in the gallery, because the gallery has the most methods to exercise the chrome. Fix it here if that is where you are, and make sure the template receives the same fix, so that the next scaffolded app does not ship the defect.

The template's [`webapp-js/docs/chrome-lineage.md`](https://github.com/Pipelex/pipelex-method-apps/blob/main/webapp-js/docs/chrome-lineage.md) is the detailed account from the other side: the commit the extraction started from, and each file it carried unchanged, adapted or left behind.

## What the chrome is

- **The run chrome**: `src/hooks/` (`useRun`, `useRunInputs`, `useFileInputs`), the run helpers in `src/lib/` (`blockingRun`, `durableRun`, `wireOutput`, `errors`, `serverEnv`, `runInputs`, `resultField`, `resultUrls`, `fileEncoding`, `usageReport`, `clientFile`, `loadBundle`, `pipelexClient`), the shared components (`RunInputsForm`, `RunResult`, `RunStatus`, `ModeToggle`, `CostReport`, `ErrorDisplay`), `src/types/pipelineError.ts` and `src/config.ts`, with their tests.
- **The codegen kit**: everything under `scripts/`, including the `make add-method` scaffold and its tests and fixtures.
- **The configuration**: the `Makefile`'s gestures and argument handling, `tsconfig*.json`, `vitest.config.mts`, and the ESLint, Prettier and Playwright configurations.

Everything else is the gallery's own: the demo methods under `methods/`, their generated trees, their actions, adapters and forms, `ExampleTabs`, the page, and the e2e specs that drive the demos.

## Where the gallery differs on purpose

These differences follow from the gallery having demos, and a port keeps them:

- **The registry.** The gallery's tabs are the `TABS` array in `src/components/ExampleTabs.tsx`, which lists the demos and carries the two `add-method:` anchors. The template registers methods in `src/methods.ts` and renders them with `MethodPage`. The scaffold writes the same entry into either file, importing the form as `./<Name>Form` here and as `@/components/<Name>Form` there.
- **The app's identity.** The gallery's title and description are written in `src/app/page.tsx` and `src/app/layout.tsx`. The template reads them from `src/site.ts`.
- **Demo-specific error handling.** The image demo keeps the `bad_image_output` kind, `BadImageOutputError` and the web-renderable URL check in `parseGeneratedImage`, and some error messages name a demo file to check.
- **The file cap's name.** The gallery's cap is `MAX_PDF_BYTES`, named after the PDF demo. The template calls the same constant `MAX_FILE_BYTES`.

Any other difference between the two copies is a port that has not been made yet. Compare the two files to find it, and carry the change in the direction the rule gives.
