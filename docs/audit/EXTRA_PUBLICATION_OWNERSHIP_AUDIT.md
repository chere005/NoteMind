# Extra publication and ownership audit

This was an additional independent source/fault audit from Root `2739785`, before the required fresh final audit wave. It is not release qualification. It did not replace the installed app or open native app windows. Root owns integrated preflight, build, memory qualification, release, and fresh reviewers.

## Implemented fault closures

| Area | Reproduction and resulting invariant | Isolated leaf |
| --- | --- | --- |
| Image export | Injected partial replacement write/EIO previously truncated existing output. Prepared guarded replacement preserves the exact prior target on precommit failure. | `74c2a28` |
| Image/drawing export receipts | Actual post-rename directory-sync EIO previously reported ordinary failure; drawing revision was lost. Known commits keep legacy path/revision receipts and report a transient warning; warning observer failure cannot undo a commit. | `74c2a28` |
| Drawing save owner | Destroying the upload owner during temporary sync now fails the final synchronous publication fence and preserves the exact prior editable archive. | `74c2a28` |
| Annotated PDF export | Actual post-rename directory EIO previously returned ordinary failure, and cancellation during temporary sync still replaced output. Keep committed receipt/warnings; fence cancellation immediately before rename. Original vector/crop/rotation/pressure semantics remain covered. | `5bbfa5c` |
| Attachment preview lifecycle | Disposal/release previously finished while a raw consumer was still creating its file; disposal admitted new work after failure. Close admission synchronously, join actual import/save/preview consumers and file cleanup, retain quota/removal authority through retries. | `b0501f1` |
| Scan request cleanup | Prompt cancellation's race receipt previously stood in for actual work completion. Disposal now joins the underlying task/cleanup. | `b0501f1` |
| Document asset shutdown | Global disposal could reopen owners and return during pending raw work or upload initialization. Failed upload cancellation, transfer lease release, raw asset release, and accepted-consumer lease release lost cleanup authority or decharged early. Retain exact pending/failed receipts and quota until backend acknowledgment, then release the final raw owner. | `e06ee88` |
| Notes/Core dependency ordering | Fire-and-forget Notes cleanup was omitted from Core's archive dependency. Phase one joins Notes producers with document/PDF/picker producers; phase two retires Notes capabilities/source files; archive remains last. Each failed phase remains retryable. | `e84d7bc` |
| Queued asset admission | A queued consumer behind an idle source transfer can otherwise hold Notes stop ahead of the final cleanup phase. Admission-only stop rejects queued consumers while live source capabilities/transfers remain owned; late ACK/cancel/release handlers remain usable. | `e84d7bc` |
| Attachment export receipt | Actual atomic export directory-sync EIO after rename previously reported failure despite saved exact bytes. Preserve the chosen-path receipt and isolate warning observer errors. | `13ce6dd` |
| Attachment preview initiating owner | Preview completion after Notepad closure or attachment/document replacement previously opened stale content and retained its temporary token. Revalidate owner/source, release unpublished token, and create PDF binding only after validation. An unrelated active-tab switch preserves the initiated preview. | `62bc8e3` |

`cbad8fe` corrects a test that assumed twenty immediate turns meant filesystem removal had finished. It joins the exact removal receipt initiated by owner destruction. A held-`fs.rm` case demonstrates why the old polling assumption was invalid. This is a fixture correction, not an additional product bug.

## Focused evidence

All checks used the candidate's pinned Electron runtime in `ELECTRON_RUN_AS_NODE=1` mode and pinned dependencies via `NODE_PATH`. They used small temporary files, source VM fixtures, and bounded real archive workers. No heavy build, native app, physical device, or full suite was run by this agent.

| Focused boundary | Observed passing run |
| --- | --- |
| Feature publication, editable drawing and native file-lock cases | 19 distinct cases across the two focused runs; the final drawing/feature run contained 11 |
| Annotated PDF publication, vector export and service ownership | 22 |
| Attachment consumers and actual scan task completion | 9 |
| Asset disposal, real-worker/preload ownership, lazy rollback and real disk admission | 55 |
| Notes/Core two-phase ordering, admission cancellation and existing IPC contracts | 33 |
| Concurrent publication/lifecycle/real-worker/disk admission check after fixture correction | 76 |
| Final attachment export/preview, thumbnail browser, scan refs and reference removal | 27 |

These runs overlap; their counts must not be added as distinct bugs or distinct checks. New fault tests were exercised before their associated fixes where recorded in the commit messages. The late drawing owner fence was added as a regression check, without a separate recorded pre-fix run.

Lazy IPC ownership fixtures inject deterministic available disk space because this Mac was near the production 2 GiB reserve. Production disk admission remains unchanged and its nine dedicated tests cover the real floor, reservations, partial writes, final-space loss and retries.

## Scope and limits

Implemented and traced publication, editable drawing, PDF export/recovery source ownership, Notes attachment import/save/preview, immutable source capabilities, raw upload/read acknowledgments, worker leases, scan cancellation, and final shutdown dependencies. Additional read-only breadth included project/file history, workspace persistence, preference writes, archive parsing, preview model ownership and frontend PDF attachment bindings. Read-only inspection is not an end-to-end pass or a proof of absence of bugs.

No confirmed fixable fault found by this audit remains unimplemented. The integrated app still requires Root's final fresh whole-app reviewers, queued release checks and memory qualification. In particular, this work does not claim physical Wacom behavior, actual native-window quit behavior, performance improvement measurements, or release readiness. No installed app or user drawing data was modified.
