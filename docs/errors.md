# Errors: what a person reads when something goes wrong

Every failure an example can meet reaches the person using it as one `PipelineError`, rendered by `<ErrorDisplay>`. The error is classified on the server, inside the helpers that call the SDK (`executeBlockingRun`, `startDurableRun`, `pollDurableRun`, the grant action), by `classifyPipelineError` in `src/lib/errors.ts`, because the SDK's error classes only match with `instanceof` there. The helpers return the classified error instead of throwing it, since a production build of Next.js turns a thrown Server Action error into an opaque digest.

## The fields of a classified error

| Field        | What `<ErrorDisplay>` does with it                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`      | The headline.                                                                                                                                                                                                       |
| `message`    | One or two sentences on what happened, in plain language.                                                                                                                                                           |
| `apiMessage` | The API's own words, in a block of their own, when `message` re-frames them.                                                                                                                                        |
| `hint`       | The next step, with an optional snippet to copy and a link.                                                                                                                                                         |
| `retry`      | Whether running it again can succeed, as the runtime judged it: a line offering a re-run when it can, and saying a re-run unchanged will fail when it cannot. Absent when nobody said, and then nothing is claimed. |
| `support`    | One line to quote to support, shown selectable in place of the bare run id.                                                                                                                                         |
| `details`    | The raw technical facts, in a "Technical details" disclosure that starts closed.                                                                                                                                    |

## A failed durable run

A durable run that ends without a result is read from **its stored error report**, the runtime's own account of the failure. The platform stores the report on the run and serves it on the status read (`RunRead.error`) and in the result lookup's refusal, which `@pipelex/sdk` hands back on the failed arm of `getRunResult`. `pollDurableRun` takes the result lookup's report, or the status read's when the lookup has none (a platform that does not serve it there yet), puts it on the `RunFailedError` it classifies, and passes the status read's `finished_at` along. The classification reads each part of the display from the report:

| The display       | From the report                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The headline      | "The pipeline run failed: " and the report's `title`, the stable label of the error class.                                                                                                                                                                         |
| What happened     | The report's `message`, which names the failing pipe, without the provider's raw text (below).                                                                                                                                                                     |
| The next step     | `user_action.detail`, the runtime's advice: change an input, choose another model, check billing. A `wait_and_retry` advice is dropped, because it says the system will retry automatically and a failed run is retried by nothing; the retry line speaks instead. |
| The retry line    | `retryable`. True offers a re-run; false says a re-run unchanged fails the same way; absent says nothing.                                                                                                                                                          |
| The support line  | The run id, `error_type` and the time the run ended, as `run <id> · <error_type> · failed <UTC time>`.                                                                                                                                                             |
| Technical details | The run's status and the report's classification (`error_type`, `error_domain`, `error_category`, `retryable`, the user action's kind, `model`, `type_uri`), the message shown above, and the validation items of a method that failed validation.                 |

**The provider's raw text never reaches the person.** When a model provider refused a call, the runtime writes the provider SDK's text into the report's message verbatim, and that text can be the raw body of the provider's error, naming the deployment's own provider account, or a whole HTML page from an edge in front of the provider. The report names that text as `provider_metadata.message`, so the classification cuts it out of the message wherever it appears, and leaves `provider_metadata` out of the technical details as well. What remains still names the pipe, the provider, the model and the HTTP status: `Pipe 'summarize' (path: two_steps > summarize) failed: openai inference failed for model 'claude-4.8-opus' (HTTP 412)`.

**A run with no report keeps the SDK's sentence**, "Run finished with status FAILED; no result available", with the bare run id. That is every cancelled, terminated or timed-out run, every run the platform finalized itself, and every failed run on a platform that serves no report; the absence of a report says nothing about why.

## Other failures

A run that fails in Blocking mode comes back as a refused request, an `ApiResponseError`, and is classified by its HTTP status like any other refusal. Every other kind (an unreachable API, a missing key, a durable-run lifecycle the URL does not serve, a file upload that failed, an output that does not match the method's contract) has its own branch in `classifyPipelineError`, and [`CLAUDE.md`](../CLAUDE.md) says how to add one.
