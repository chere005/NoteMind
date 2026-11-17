# NoteMind 0.36 reliability audit

Audit baseline: `cbf8afb` (0.35.0). Candidate: 0.36.0. The installed application and user documents were not changed during this audit. Regression checks use temporary profiles and hidden windows, with native device capture disabled. Physical pen-driver behavior is not inferred from synthetic events.

This is a list of reproducible defects, not a count of suspicious lines. Related symptoms share one row. P1 means interrupted core work or potential loss of unsaved content; P2 means a material correctness or performance defect. Source locations can be found using the named functions; test files contain the reproductions.

| ID | Priority | Source entry | Reproduction and consequence | Candidate fix / regression evidence |
|---|---|---|---|---|
| A01 | P1 | `src/notes-store.cjs:70` | Commit a new recovery archive, interrupt its companion-state commit, then reopen. An old clean flag can make recovery reopen the older disk file instead of new unsaved text. | Recovery state is embedded in the same archive; generation-matched companions allow explicit restore updates. `draft-crash-state.test.cjs`. |
| A02 | P1 | `src/tablet-entry.tsx:144` | Add ink while Save Drawing is awaiting its dialog/write, or reorder/rename the sheet. Completion marks the newer ink clean or updates the wrong sheet. | Capture the written signature and retain initiating page identity. `drawing-save-race.test.cjs`. |
| A03 | P1 | `src/tablet/main/pen/manager.ts:314` | Replace a pending pen backend start, then let its old timeout/completion arrive. It stops the healthy replacement. | Match completion to the current backend run and generation. `pen-manager-start.test.cjs`. |
| A04 | P1 | `src/tablet/renderer/TabletSurface.tsx:527` | Switch source/document before an active tablet stroke lifts, or quit while the pen remains down. The uncommitted gesture is absent from cleanup/flush snapshots. | Commit the gesture to its original page during cleanup/flush; snapshot live page models before saving. `tablet-viewport.test.cjs`, `drawing-quit-flush.test.cjs`. |
| A05 | P2 | `src/tablet/renderer/TabletSurface.tsx:475` | Lift at a newer point than the last move. The final stroke segment is absent. | Retain valid lift coordinates; out-of-range native releases retain the last valid position. `tablet-viewport.test.cjs` and `pen-release-position.test.cjs`. |
| A06 | P1 | `src/tablet/renderer/sheetViewport.ts:6` | Restore a page with aspect 0.64944 in the 1080×1788 tablet stage. Contain-only sizing leaves about 125 px of unused vertical area. | Fill both measured dimensions with real writable paper. Uniform canonical transforms preserve ink/backdrop geometry and undo identities; margin ink persists and exports. `tablet-viewport.test.cjs`, `tablet-sizing.test.cjs`, hidden `pad-app.cjs`. |
| A07 | P1 | `src/zip.cjs:9` | Edit an image-heavy note. Every recovery/version/save preparation recalculates bitwise CRC and recompresses unchanged assets synchronously. | Native CRC, portable table fallback, bounded 32 MiB/512-entry compressed-byte cache, and dedupe before version encoding. `zip-cache.test.cjs`, `version-dedupe.test.cjs`, `scripts/benchmark-archive.cjs`. |
| A08 | P2 | `src/index-images.cjs:9` | Request indexing for new/removed images while the old snapshot is being read. Requests join the old promise and stale text is committed. | Supersede old snapshots, cancel obsolete OCR, reuse completed unchanged reads and commit the newest inputs. `image-index-race.test.cjs`. |
| A09 | P2 | `src/index-images.cjs:35` | Automatic image indexing arrives through renderer IPC. It is incorrectly foreground work and can delay explicit reading; cached runs also rewrite the library unnecessarily. | Automatic calls carry background priority; explicit reading can preempt them; unchanged indexes skip writes. `image-index-race.test.cjs`, existing `ocr-lifecycle.test.cjs`. |
| A10 | P2 | `src/notes-core.js:36` | Change images in tab A, type in tab B within 3.5 s. A single global timer cancels A's indexing/last-image cleanup. | Per-tab timers and retained image-search eligibility. `image-index-scheduling.test.cjs`. |
| A11 | P2 | `src/read-limited.cjs:3` | Open/attach an oversized file. Limits are checked only after its entire contents have been allocated; text/notepad opening has no file-size gate. | Check size before reading and enforce a streaming limit even if the file grows; cancellation closes the stream. `read-limited.test.cjs`. |
| A12 | P2 | `src/markdown-reference-rewrite.js:4` | Save Markdown containing escaped destinations or multiline titles; or update a tablet image whose name also appears in prose/code/longer filenames. Literal string replacement misses valid links or corrupts unrelated text. | Shared parser-backed destination edits preserve Markdown syntax and code literals; batch mappings avoid parsing once per asset. `markdown-reference-rewrite.test.cjs`, `graphic-reference-replace.test.cjs`. |
| A13 | P2 | `src/features.cjs:17` | Delay the first preference write, complete the second, then release the first. The older value wins on disk. | Serialize writes per key with independent errors and progress for other keys. `preference-ordering.test.cjs`. |
| A14 | P2 | `src/tablet/renderer/orientation.ts:107` | Change orientation before its startup preference request resolves. The old answer overwrites the new choice. | Revision-guard startup reads and shared/local changes. `pad-orientation.test.cjs`. |
| A15 | P2 | `src/workspaces.cjs:116` | Convert a legacy project when an unrelated valid same-stem project already exists. The wrong project opens as the conversion. | Verify provenance/equivalent links and choose a new sibling without modifying collisions. `legacy-project-collision.test.cjs`. |
| A16 | P2 | `src/document-worker.js:7` | Open a corrupt/password-protected PDF whose loading promise rejects. Worker cleanup is outside the rejection path. | Put loading inside the task cleanup scope. `pdf-worker-lifecycle.test.cjs`. |
| A17 | P2 | `src/notes-find.js:53` | Find `cat` in `cat cat`, replace with `cats`, then Replace again. It edits the first replacement to `catss`. | Advance from the inserted text's end. `find-replace-progress.test.cjs`. |
| A18 | P2 | `src/notes-find.js:25` | Whole-word Find `cat` after a separate paragraph ending in `a`; visual search sees `acat`. Matches can also bridge blocks/cells. | Preserve block/BR/cell search boundaries while joining inline formatting. `find-visual-boundaries.test.cjs`. |
| A19 | P2 | `src/notes-writing.js:34` | Confirm IME composition with Enter/Tab/punctuation inside lists, quotes, paired text or tables. Editing shortcuts intercept composition and alter content. | Composition guards in editing handlers. `ime-composition.test.cjs`. |
| A20 | P2 | `src/shell.js:20` | Choose two sidebar filters rapidly; resolve the older request last, or return to the normal view before it resolves. Stale hits replace the current view. | Latest-request ownership and back-action invalidation. `library-filter-race.test.cjs`. |
| A21 | P2 | `src/notes-library.js:15` | Select an older version while a newer version preview is loading; the older request finishes first. Late results replace both preview and Restore action ownership. | Version preview request ownership. `version-dialog-lifecycle.test.cjs`. |
| A22 | P2 | `src/notes-attachments.js:12` | Remove an attachment referenced with a title/reference/escaped destination. Bytes disappear while the Markdown link remains broken. | Parser-aware removal of exact attachment references. `attachment-reference-removal.test.cjs`. |
| A23 | P2 | `src/notes-pdf.js:7` | Start PDF/Word export on A, switch to B while choosing options, then accept. B can be previewed/exported instead. | Freeze the initiating document before awaiting options and reuse it through preview/export. `export-document-ownership.test.cjs`. |
| A24 | P2 | `src/guarded-write.cjs:3` | Two processes read the same abandoned PID lock before either cleans it up. A delayed cleaner removes a replacement live lock; old library locks also evict live owners by age. | Verify inode/device ownership on cleanup/release and never age-evict live library owners. `lock-ownership.test.cjs`. See remaining limitation below. |
| A25 | P2 | `src/tablet/renderer/TabletSurface.tsx:243` | Rescan replaces the backdrop on an existing page object; the paper effect does not rerun, leaving the old background visible until a resize. | Depend on the actual backdrop value, with an actual-component repaint regression. `tablet-viewport.test.cjs`. |

## Performance evidence

Same machine, Node v26.9.0, sequential runs, no concurrent build. These are archive-preparation timings, not a claim about total save latency or physical pen latency.

| Workload | 0.35 baseline | Candidate |
|---|---:|---:|
| Representative 14.5 MB archive, 18.4 MB decoded assets: repeated edited encodes | 753–803 ms | 27–40 ms after initial compression |
| Same archive: decode | 425 ms | 42 ms |
| Deterministic synthetic 18 MiB binary assets: repeated edited encodes | 684–696 ms | 23–28 ms after initial compression |
| Synthetic archive: first encode | 727 ms | 373 ms |
| Synthetic archive: decode | 364 ms | 21 ms |

The packaged large-document run measured 7.2 ms typing P95 with 100 images, 0.30 ms selection-handler P95 with 10,000 strokes/200,000 points, zero vector redraws during selection dragging, and one paint call when adding a new stroke.

The first compression still costs hundreds of milliseconds. The cache retains only compressed bytes, never user asset strings or original buffers, and is bounded by both byte count and entry count. It is process-local and not persisted. Benchmarks validate their final decode. The reproducible synthetic workload is in `scripts/benchmark-archive.cjs`; local measurements live in ignored `test-results/audit/`.

## Coverage and release gate

Reviewed: drawing/page lifecycle and persistence; pen ownership/start/stop and event synthesis; viewport/rotation, mirror input and backdrop/export alignment; archive encoding/decoding and bounds; draft recovery and document save conflicts; preference ordering; Markdown assets, imports, PDF/Word lifecycle; image indexing priority/cancellation; editor history, composition, search/replace, attachments, menus and delayed dialog results; projects, legacy conversion, recents and file operations.

Independent cross-review also caught candidate regressions in tab-expanded Markdown anchors, pending-save keep flags, and invalid native leave coordinates; these were fixed before packaging and are not counted as additional baseline defects.

Final release gate passed: **297/297 Node tests** and **43/43 hidden packaged application checks**, including native pen IPC, full-stage margin persistence/export, real preference reopen, recovery, menus, graphics insertion and large-document behavior. No tests were skipped within the macOS gate. All 405 packaged source/assets match the frozen source (the two separately signed native helper binaries are verified by the application signature). Strict deep macOS code-signature verification passed.

The first packaged margin probe exposed a fixture issue: it used a stale saved baseline and sent duplicate DOM pen events while native capture was active. The fixture now flushes explicitly and uses the native sample path; its focused run and a complete 43-check rerun passed against the unchanged signed build. The first Node pass also exposed two isolated test fixtures missing newly introduced module dependencies; those fixtures were updated and the entire suite rerun successfully. Logs: `test-results/preflight-0.36.log`, `test-results/build-0.36.log`, `test-results/packaged-0.36.log`, and `test-results/validation-packaged/summary.json` (ignored local artifacts).

No candidate installation was performed during this audit. `/Applications/NoteMind.app` remains 0.35.0; the signed 0.36.0 candidate is in `dist/NoteMind/NoteMind.app`.

## Remaining engineering work

- Replace reclaimable PID lockfiles with stable native locks. The inode checks close the reproduced stale-read sequence, but `stat` followed by `unlink` is not an atomic filesystem operation. A paused cleaner can still race a replacement. A proper follow-up needs a stable shared lock registry, native nonblocking locks, process-death recovery, profile/old-version interoperability and fallback tests; do not label the current guards as a complete OS-level locking guarantee.
- Bound or deduplicate automatic version storage. Six distinct autosaves of a note with one unchanged 256 KiB asset created six full archives totaling 1,577,560 bytes; history currently has no retention limit. This storage/write amplification needs an explicit history policy and migration that preserves existing recovery points.
- Move cold archive preparation off the Electron main thread. Repeated assets now reuse compression, but first saves and new large assets still incur measured synchronous work.
- Exercise the physical Wacom driver across actual permission changes, sleep/wake and connection changes. Hidden tests cover the app's real IPC/event paths and geometry; they cannot certify hardware delivery or the user's driver mapping.
- Run Windows/Linux native-backend and packaging checks on those systems. The current build/validation environment is Apple Silicon macOS.
