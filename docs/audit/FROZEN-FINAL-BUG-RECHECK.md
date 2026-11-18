# Frozen final bug, data integrity, and architecture recheck

Reviewed on 2026-11-18, starting from exact source `9532d9004d2d1861695171f2705fef67e810f688`, in isolated branch `audit/frozen-final-bug-recheck`. This report records this independent pass only. Earlier `FINAL-WHOLE-APP-{BUGS,UI,PERFORMANCE}.md` reports were historical context, not evidence that the new integration was correct.

## Result and integration boundary

Eleven confirmed defects were repaired in eight explicitly owned commits. Thirty-six new regression cases passed together, serially, in the pinned Electron-as-Node runtime: **36 passed, 0 failed, 0 skipped**. Those are focused source/fault checks, not the full application suite or a packaged release test.

| Commit | Owned product paths | Confirmed defects |
| --- | --- | --- |
| `d12c4bf` | `src/features.cjs` | F1 |
| `92ce8ca` | `src/pdf-reference-service.cjs` | F2, F3, F4 |
| `41a4526` | `src/notes-store.cjs` | F5, F6 |
| `12dd042` | `src/word-preview-sessions.cjs` | F7 |
| `1223f22` | `src/word-preview-sessions.cjs` | F8 |
| `f8c2350` | `src/word-preview-files.cjs` | F9 |
| `d30a08c` | `src/word-inline.cjs` | F10, F11 |
| `c6093e3` | `src/word-preview-sessions.cjs` | F8 integrated quit follow-up |

No Root, candidate, installed-app, or user-profile files were changed by this reviewer. These commits need Root's combined-source gate; no package/native/device readiness follows from this isolated branch. Root reported an actual full preflight exit 0 at the older frozen source (3254 passed, 0 failed, 1 skipped); this reviewer did not run or independently observe that suite.

## Confirmed findings and causal proofs

### F1 — Private drawing save receivers survived their final consumer (P2)

`features.cjs` save-pane encoded archives using the actual archive Worker but did not explicitly retire the returned private bytes after publication, guarded-write failure, or post-encode owner loss. A frozen-source focused proof retained an otherwise completed 1191-byte receiver; the failure case retained 1190 bytes. This was an ownership failure, not evidence of a quantified process-RSS leak.

The receiver is now retired in the outer `finally`, before releasing an upload lease. Retirement remains conservative for borrowed/pooled buffers. New actual-worker cases cover legacy and uploaded success, guarded failure, owner loss, and post-commit directory warnings, preserving public revision and exact caller ink including signed zero, pressure, and color. Five new cases and eleven existing affected publication/guard checks passed during development.

### F2 — PDF close admitted new work after taking its drain snapshot (P1)

A held accepted ink save followed by explicit close and another save dispatched two writes on frozen source. Close only captured the first write and could retire the source before the newly admitted write completed. Read consumers were also absent from the source-retirement drain.

A per-state closing phase now fences ordinary admission immediately, joins concurrent close attempts, drains accepted saves/exports, cancels accepted read/open requests, waits for their actual settlement, and only then disposes the client/source. Same-source open waits for that retirement and creates a fresh handle. Tests hold the save and read receipts independently, assert no late dispatch, preserve another handle, exercise capacity eviction, and join explicit close with owner shutdown. Accepted published work is never replayed.

### F3 — Partial PDF client cleanup lost retry authority (P2)

The actual `WorkerClient` implementation set `closed` before native-window destruction. With a controlled Window whose first `destroy()` threw, the next dispose returned early while the same window remained live. A separate controlled client cleanup failure demonstrated the required per-source retry behavior.

Ordinary admission stays closed during partial cleanup; another close retries only unfinished disposal on the same identity. A pre-cleanup write failure can restore admission only while the existing client is still usable. Native destruction attempts are guarded against reentry. The actual WorkerClient code is tested with a controlled Window, captured wire request IDs, source-opening AbortControllers, and a destroy fault. This is not a real native-window test.

### F4 — Same-source PDF reopen returned a dead renderer's stale handle (P2)

A controlled client crash followed by same-source open returned the prior dead handle on frozen source. A retained dead handle could also block unrelated new source admission.

Dead clients are now excluded from reuse and preferentially retired before reuse/eviction. Two direct service cases cover same-source fresh-handle recovery and a dead retained handle beside a live unrelated handle. The PDF leaf has eleven new cases; its affected service, IPC, and shutdown run passed 31 cases during development.

### F5 — A parser ENOENT could overwrite an existing note library with empty records (P1)

`readIndexState` caught both filesystem reads and parsing in one ENOENT fallback. A parser/backend ENOENT therefore masqueraded as an absent index. The exact NotesStore transaction proof started with a `keep` record and injected only parser ENOENT; frozen source rewrote the file with `records: {}` while changing the sort field.

Only `fs.readFile` ENOENT now selects the empty-library fallback. Parser/backend failures propagate. The new proof asserts the previous index file remains byte-for-byte intact and the transaction rejects with ENOENT. No parser error is silently converted into a first-run library.

### F6 — Private index encode/read receivers lacked consumer retirement (P2)

Transactions retained private stringify output on changed, unchanged, and cancelled paths. `readIndex` consumed the wrapper without retiring it; parse failures also lacked retirement. The public `readIndexState` success contract, conversely, intentionally transfers intact encoded ownership to its caller.

Transaction and consuming-read `finally` paths now retire only private exact backing stores after their consumers finish. Failed parsing retires its private input. Successful `readIndexState` keeps returned bytes intact until its caller retires them. Seven new cases cover actual Worker serialization, changed/unchanged publication, cancellation, parser failure, failed publication, successful caller ownership, and unchanged partial/pooled borrowed views. Twenty existing NotesStore/durability/guard checks also passed during development. No RSS savings are inferred from detached-byte assertions.

### F7 — Failed Word preview cleanup could never be retried (P2)

After actual worker exit, a transient EACCES unlink failure rejected the memoized retirement promise. Later dispose calls repeatedly rejected with that same memoized failure instead of retrying the unfinished owned cleanup. The frozen-source proof used an actual private directory/file with a controlled worker exit.

Retirement retains the exact affected session identities and cleanup phase. A later disposal retries unfinished cleanup after the original actual-exit barrier and existing consumer acknowledgments. Ordinary admission remains closed. Successful jobs, worker termination, and invalidation notifications are not replayed. Cases cover repaired unlink and concurrent cleanup retry held by another exposed consumer acknowledgment.

### F8 — Rejected Word worker termination could not be retried (P2)

A first controlled `terminate()` rejected EAGAIN without emitting exit. Another dispose never issued a second termination attempt (`1 !== 2` in the pre-fix proof), so retirement remained pending even after the transient fault was repairable.

A settled failed termination attempt is retained separately. A later disposal retries only that attempt; concurrent requests join it. The original single actual-exit cleanup continuation remains authoritative. The proof preserves exact owned HTML through the first failure and a subsequent fulfilled `terminate()` result; only an actual exit permits cleanup. It verifies two attempts total for concurrent retry, zero remaining sessions after exit, and no replacement worker.

A further actual-source Core + documentIO + Word IPC proof at integrated Root `9dcab99` exposed a missing integration condition in the first isolated repair: leaving the first failed stop pending let both wrapper layers memoize that promise, so repeated user quit still never reached a second terminate call. Commit `c6093e3` surfaces `WORD_PREVIEW_RETIREMENT_UNCONFIRMED`, `resourcesReleased: false`, and the original error cause on a settled termination failure. Existing wrapper rejection paths reset their attempt without changes. The original actual-exit cleanup promise remains independent; a fulfilled termination result never substitutes for actual exit.

Two integrated cases cover completed-open and held-active plus queued-read states, including concurrent repeated quits. Both assert first typed retained-ownership failure, exact original journal/HTML/authority before exit, exactly two termination attempts, no early archive release, then exactly one archive checkpoint and permitted quit after actual exit. The former pending-dispose test was strengthened to require a typed rejection while exact marker bytes and session ownership remain intact, then actual-exit cleanup. The affected service/IPC/Core/document quit run passed **31 cases**. This is closure of F8, not an additional inflated finding count.

### F9 — Final Word directory removal lost authority after retiring its marker (P2)

`cleanupPreviewFiles` unlinked its verified marker and then called rmdir. One transient EACCES from final rmdir left an empty owned directory; every later cleanup failed ENOENT opening the now-retired marker. The frozen-source real-filesystem proof reproduced that irreversible cleanup state in 22 ms.

An internal WeakMap now records only the completed marker-retirement phase for the exact same authority object. Retry verifies the captured directory dev/ino, uid, type, and realpath and attempts only empty-directory rmdir. It confers no generic missing-marker cleanup authority. Copied/unissued authorities still reject, foreign markers/siblings survive, and substituted directories or changed uid refuse cleanup. Four new cases plus affected file/retirement cases passed 13 focused checks. This receipt is deliberately not serialized or reconstructed for an unknown markerless folder after a process crash.

### F10 — Noncontiguous Word delimiter sealing left private scratch live (P2)

The seal pass allocated a local used-count Column and never explicitly retired it on success or a cancelled fill. Tiny direct exported-Delimiters proofs created two interleaved lists and captured the exact scratch ArrayBuffer: 8192 bytes remained live on each frozen-source path.

A `finally` now releases only that local Column. Published delimiter ordering remains usable until the existing outer owner retires it. Success and cancellation cases assert zero captured scratch bytes, correct row ordering, and unchanged caller lifetime. This is deterministic backing-store retirement, not a demonstrated process-RSS reduction.

### F11 — Cancelled Word linkification left its unpublished order live (P2)

The linkify helper built a new local order Column before adopting it into the existing token owner. If cancellation interrupted candidate traversal after the first link, the local order became unreachable without explicit retirement. The tiny captured-backing proof retained 8192 bytes while the original caller order remained valid.

An adoption flag and `finally` now retire only an unpublished local order. Cancellation preserves the original caller token sequence/order. Successful adoption keeps the replacement usable until `releaseInline`; borrowed extension arrays and bytes remain intact. Four new scratch cases and the existing semantic/cache/postprocessing/nested/cancellation groups passed **46 cases**, including the 500-input deterministic grammar corpus. No grammar, rule, runtime setting, or cap changed.

## Entry-point and architecture inventory

This was a risk-directed source re-inventory and fault pass, not a claim that every source line or every input permutation was exhausted.

| Surface | Independently traced contracts |
| --- | --- |
| Main and IPC | `main.cjs` startup/open/save/file handlers, dirty/flush progress and completion, per-sender request ownership, accepted operation barriers, Core will-quit dependency ordering; `notes-ipc.cjs`, asset IPC, Word preview IPC, PDF service admission and owner teardown. |
| Persistence/publication | `notes-store.cjs`, snapshot validation, guarded file replace and fingerprints, file-operation requests/history, drawing save uploads, sheet read/transport cleanup, archive encode/output ownership, raw owner/lease and source-file claims. Reviewed cancellation before/after publication and post-commit warnings separately. |
| Editor | Canonical document text versus active Source/visual ownership, inactive view retirement, source-caret receipts on active and inactive programmatic edits, insertion ownership, history/find/format consumers, autosave adoption, manual save and close flush. No user editor/profile was opened. |
| Pen/display | macOS backend generation fences, child stdin/stdout/error and heartbeat handling, restart timers, manager/dispose, renderer button action mapping and input targets. The lower/upper action paths were read; physical Wacom behavior was not exercised. |
| PDF references/import/export | Service/client source opening, same-source reuse, retained/closing eviction, per-state save/export/read consumers, ink-store revision/CAS and original source retention, import route, export leases and markup publication. F2–F4 came from this recheck. |
| Word/import/export | Private semantic preview worker/session/consumer acknowledgment lifetimes, exact file/journal ownership, budget-file cleanup, export job actual-exit joining, imports and packed inline child creator ownership. F7–F9 came from this recheck. |
| Images/camera/overview | Image source reservations, engine/working leases, indexing activity/deadline wake, document continuation, attachment read/admission, camera owner/cancel seams, overview owner/disposal and compact geometry batching. Reviewed existing source seams; no model/native/camera workload was launched. |
| Shutdown/retry | Producer drain before asset cleanup, persistence before archive teardown, actual helper/worker exit before owned-file retirement, repeat dispose after a cleanup fault, joined concurrent close, and immutable identity during retry. |

Recent frozen integration re-read included missing-lease union handling `138c14f`, active/inactive source-caret retirement `4ce18ae`, early index deadline wake `b802983`, Word packed inline postprocessing/creator retirement `85f5dd8` + `588e603`, and bounded compact-geometry hydration `18f5040`. These reads do not substitute for their authors' benchmark or native evidence. The Word scratch read-around lead was independently proved and closed as F10/F11 after coordination with the performance owner.

## Verification and limits

The final 36-case check used the seven new files: `feature-archive-retirement.test.cjs`, `pdf-close-admission.test.cjs`, `notes-index-byte-retirement.test.cjs`, `word-preview-retirement-retry.test.cjs`, `word-preview-files-retirement-retry.test.cjs`, `word-inline-scratch-retirement.test.cjs`, and `word-preview-core-retirement-retry.test.cjs`, with `--test-concurrency=1`, `nice -n 15`, `ELECTRON_RUN_AS_NODE=1`, and the stable candidate's pinned Electron/runtime dependency directory. No full suite, build, native helper, large stress workload, model load, or desktop interaction was run by this reviewer. Development affected-group counts overlap and must not be added into a unique aggregate.

No cap, input fixture, thread count, heap setting, or resource threshold was reduced. No forced GC or cache flush was used. Product resource requirements remain 1 GiB aggregate / 900 MiB renderer / 384 MiB raw / 2 GiB disk floor.

The previously reported full-100 production Web and experimental Native memory failures remain outside this pass's closure. The active 16 MiB textarea layout failure remains distinct from the successful counter-only case. Complete top-three bottleneck measurement at every pipeline stage was not established here. This report makes no bug-free, universal-performance, installed-version, or production-readiness claim.
