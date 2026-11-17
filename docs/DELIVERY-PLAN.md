# NoteMind delivery plan

Updated November 17, 2026, 10:55 AM Central. This is the active plan for the whole requested scope, including the next stable increment, all approved features, and every required review round.

## Incremental timeline and priorities

Revised after Sean's request to make progress visible sooner and review the features together with performance work. **Feature integration starts now.** Foundation memory/export fixes stay actively owned in parallel; the broad review is moved onto the first useful feature bundle instead of waiting for a separate foundation-only audit.

The working estimate remains **12–24 hours for the first stable test bundle** and **48–84 hours for the full scope**. Earlier checkpoints should arrive well before that. These ranges include the currently known fixes and required review rounds; they do not promise a release while a known supported workflow is still failing.

| Checkpoint | Working window from this revision | Visible result and pause point |
|---|---|---|
| **A — tools and presets** | **Next 1–2 hours** | Integrate saved pen/eraser/select presets and focused quick switching into the current app source. Repeat actual main/tablet UI and drawing-host checks. Save a tested source checkpoint with an exact feature/status record. |
| **B1 — useful ink selection** | **Approximately 2–5 hours** | Click selection, delete and duplicate working through the actual Surface/App controls, with one Undo, owner safety and preserved pen-button maps. This is a meaningful independently saved increment. |
| **B2 — complete ink editing** | **Approximately 4–8 hours** | Add lasso, move, recolor and width editing, including modifiers, cancellation, new pen appends and large selections. Focused bug/UI/performance checks run against this integrated feature. |
| **C — PDF reference and markup** | **Approximately 8–16 hours** | Prioritize the essential right-pane PDF workflow: navigation/fit/zoom/search, Wacom ink, durable page edits/recovery and annotated export. Reconcile raw/chunked transport with the current foundation and validate the real workflow. |
| **First stable bundle** | **Approximately 12–24 hours** | Review the core + presets + selection + PDF workflow as one useful bundle. Close findings and known stability blockers, then freeze, preflight, package and verify a candidate. Notify before installation. |
| **D — overview and large imports** | **Approximately 12–24 hours, overlapping independent work** | Finish only-visible thumbnails, stable-ID page reorder, camera/SVG coverage and cancellable page-by-page PDF/scan imports. Save separate tested checkpoints as each lands. |
| **E — precision tools** | **Approximately 16–30 hours** | Add anchored zoom/pan/fit and line/angle constraints, coordinated with the new selection handlers. Test actual drawing, rotation and exports. |
| **All-feature review** | **Approximately 30–48 hours** | Independent bugs/UI/performance panel over all integrated features; implement and retest findings. |
| **Final audits and release** | **Approximately 48–84 hours** | Three fresh whole-app audits, finding closure, final frozen stress/recovery/soak, full packaged validation/signatures and Claude handoff. |

The windows overlap where source ownership is independent. They are not durations to add together. The short checkpoints are saved, reviewable increments; they are called install-ready only after the applicable release gate passes.

### What changes in the execution order

1. Integrate the already prepared presets feature immediately; do not leave it waiting behind the largest stress case.
2. Give selection editing and the essential PDF reference workflow the next feature priority.
3. Continue the editor-memory, normalization, Word/export and PDF import fixes in parallel with those features.
4. Run focused correctness, UI and representative performance checks at each integration, so fixes respond to the actual features.
5. Run the first broad three-way panel on the useful integrated bundle. Keep the later all-feature panel and three fresh whole-app audits.

### What a good pause point contains

At each lettered checkpoint, preserve the exact source commit, completed behaviour, relevant test/performance evidence, any separate preview artefact, and the next dependency/owner in the handoff. The checkpoint must be recoverable without reconstructing transient work. If another lane is midway through a fix, it keeps a separate committed branch and an exact handoff.

Report the checkpoint in chat when reached, alongside the hourly whole-roadmap update. Continue into the next authorized increment unless Sean asks to pause. Do not restart or replace the running application merely to demonstrate progress.

## Installed version and release handling

- Installed NoteMind is **0.35.0**, verified from its application bundle during this update. Audit work has not replaced it.
- The 0.36.0 package is the previous separately tested comparison candidate. Its historical checks do not certify the current development source.
- The first useful stable bundle is intended to be 0.37.0. Releases bump the minor version.
- Keep development, fixtures and feature work isolated from Sean's running application and documents. Notify before the next installation; do not restart the working app as part of a test.
- Run one heavy build/native stress job at a time, at reduced priority, with hidden nonfocusable windows, temporary profiles, and physical media/pen access disabled.
- Keep the existing workload limits and resource guards. Do not lower supported inputs or force garbage collection to make a test appear to pass.
- Keep findings and requested planning in this chat/repository; do not put this work in TaskMind.

## Work happening now

| Work package | Owner | Present evidence | Required next result |
|---|---|---|---|
| Editor decode and hydration memory | Architecture investigator plus a fresh independent memory reviewer | Legal 2M-dot editor load crossed the 1 GiB combined guard before painting. Disabling history priming still exposed decode/cache/worker memory. A 1M attribution reached decode, then crossed the guard in old history construction. | Complete staged attribution and make the actual editor load, edit, Undo/Redo and save fit the resource target. A worker-only result is insufficient. |
| Undo memory accounting | Fresh independent reviewer, with a separately implemented ledger helper | New direct-stroke history leaves and a typed resource ledger pass 38 focused history/page/ledger/transform checks. This removes eager per-stroke accounting wrappers while preserving exact public stroke arrays. | Native staged 2M validation, shared-resource/slot-reuse/cancel/release verification, and integration into the full editor gate. |
| Dot bounds cache | Root | Isolated change computes empty/dot bounds in O(1), without keeping a rectangle object for every dot. Fifty thousand retained dots create zero stroke-cache entries. Thirty related checks pass; independent source review found no actionable issue. | Measure the change in the actual decoder/editor, integrate it with the history fix, and retain signed-zero/aggregate-bound correctness. |
| Normalization worker lifetime | Drawing owner, with architecture attribution | A large load can leave its shared normalization/hash worker alive for ten seconds after output transfer. The attribution identified substantial worker/transient memory outside the renderer's reported JS heap. | Retire an owned load-normalization worker before hydration while preserving unrelated exporter jobs, exact results and cancellation. |
| Renderer packet/membership allocation | Drawing owner | Typed raster delta/Undo/ACK and pressure pixels pass. Initial actual producer packing still has avoidable order/addition/ID arrays and large numeric Sets. | Bounded membership storage and initial packet sharing, duplicate/multiplicity correctness, deduplicated transfers, then full producer memory and responsiveness proof. |
| Scan colors | Architecture owner | Original six managed-color cases now match exactly in source and copied packaged helpers, with actual local qcms Wasm execution proved. The expanded 20-case oracle, including dark cHRM-without-gAMA, now passes exactly in both layouts after the further fix. | Preserve the proven color path through feature integration and repeat its frozen packaged coverage. |
| Word export caller and conversion | Drawing owner | Stream writer and crash-safe temp handling are integrated. Caller checkpoint uses bounded spools, verified file conversion, worker-only image-name parsing and workspace admission after source unpinning. Focused caller/writer checks pass. | Actual mixed-media conversion above 2400 pixels, maximum legal converted PNGs, cancellation/reset/conflict tests, and near-16-MiB structured Markdown stress. |
| Page overview integration | Root / next available feature owner after the higher-priority PDF checkpoint | Virtualized component, stable owner models, pointer reorder, mirror keys and camera transforms pass 24 focused checks. Branch is refreshed against committed foundation source. | Actual App/camera opening adapters, input suspension, visible-only SVG normalization through the landed file converter, and hidden native opening/reorder/camera/SVG proof. |

The targeted author and independent memory reviews above do **not** count as any of the formal completion panels below.

## Core safety and reliability carried through the increments

### Drawing, Wacom and page correctness

- Preserve lower physical pen-button delete/erase and upper-button selection, including custom mappings and delayed native tip/button reports.
- Preserve right-click selection in the pane, single-gesture Undo, pending native contact finalization and original-page ownership through tab switches, portal moves and shutdown.
- Verify that paper fills the measured tablet surface in both orientations, with correct writable margins, unchanged canonical ink, backdrop alignment and exports.
- Verify inserted page backgrounds, separate page blocks and removal of the extra inter-page gap.
- Exercise menus, focus, tooltips and both main/tablet controls without adding persistent instructional or diagnostic prose to the drawing pane.
- Check cancellation, clear, Undo/Redo, erase and selection while prior ink/save work is still finishing.

### Persistence, recovery and file ownership

- Verify draft generations, interrupted saves, last autosave recovery and close/reopen/reclose behaviour.
- Preserve captured save targets, exact committed receipts and external-edit conflict detection; never replay a file write merely because later hydration/cleanup failed.
- Keep file history and Markdown companions exact while using direct file/CAS ingestion instead of whole old-file materialization on Main.
- Verify native locks, compaction/staging provenance, temp cleanup, worker death, directory/inode sync failures and explicit Windows durability capabilities.
- Verify owner-scoped raw asset leases, capacity waits, cancellation, late responses and cleanup after worker/window loss.

### Imports, exports and supporting workflows

- Finish cancellable, text-first/page-by-page PDF attachment conversion. Render/OCR only pages that need it rather than retaining every full-page raster up front.
- Preserve PNG/JPEG color metadata, EXIF plus explicit rotation, exact original bytes and supported image formats through scan/picker paths.
- Finish streamed Word caller/conversion/metadata handling, with the previous target preserved until guarded publication and exact receipts after publication.
- Recheck print/file-backed previews, attachment lifetime, OCR priority/worker reuse, indexing ownership, and delayed dialogs against their initiating note.

## Performance programme: every stage, top three bottlenecks

At the performance pass, profile complete stages with the same input, runtime, scope and limits. Rank the top three measured bottlenecks at each stage, address them, and repeat the full stage. The following are the current work targets; final rankings must follow measurements rather than this table alone.

| Stage | Current three priorities |
|---|---|
| Pen/contact handling | Synchronous lift fingerprints; dense erase/selection preparation; queued input/save ownership and finalization. |
| Decode and editor load | Per-stroke bounds/fingerprint objects; Undo accounting wrappers; lingering normalization workers and duplicate input ownership. |
| Painting and editing | Main-thread full repaint; whole-order rebuilds for small changes; producer identity Sets/reference arrays and repeated packet encoding. |
| Asset transport and memory | Repeated base64/whole-envelope IPC; private buffers retained after consumption; capacity deadlocks between pinned inputs and conversion/history workspace. |
| Saves and history | Full JSON rewrites for small appends; whole previous archives during version capture; compaction/durability/cleanup work extending critical save paths. |
| PDF/scan/OCR import | Rendering every page before text decisions; full-image decode/metadata/color handling; repeated OCR starts and foreground/background contention. |
| Export and preview | Collecting all expanded image media; whole Word paragraph/XML object graphs; full-document raster/byte copies in PDF, print and reference paths. |

Required measurements include wall time, Main/renderer timer gaps, UI frame gaps, bytes copied/written/transferred, retained ownership, actual V8 limits, and combined owned process memory. Setup/oracle time stays separate from application-operation time. Sampled peaks are labelled as sampled peaks.

### Representative acceptance workloads

- 100k strokes × 20 points and the distinct 2M one-point-stroke extreme: load, first paint, append/lift, erase, dirty-frame ACK loss, Undo/Redo, reorder, selection, save and reopen.
- Large pressure strokes, repeated stroke references, empty strokes, signed zero, exact Float64 geometry, color case, near-limit capacity and cancellation during preparation.
- 100 distinct real 1800×2400 JPEGs: open/hydrate, first viewport, typing, draft/autosave, scrolling, tab return and recovery. The earlier >1-GiB save run remains unresolved until the current whole pipeline passes.
- 100-page scans with large PNG/JPEG pages, held concurrent raw leases, rotations, color profiles, page limits and cancellation.
- Word export with hundreds of MiB of expanded media, real unsupported/oriented image conversion, and many short paragraphs/list items near the supported text limit.
- Multiple queued large saves, a nearly full raw pool, old-version publication, worker restart, owner destruction and failures before/after file rename.
- Large PDF reference navigation/search/markup/export and overview virtualization, once those feature adapters are integrated.

### Zstd decision

Zstd has been benchmarked in the actual Electron runtime. Large legacy geometry JSON compressed smaller and faster than deflate in the codec test, but complete small fsynced writes became slower, and already compressed JPEGs gained nothing useful. Keep latency-sensitive internal extents raw by default and public ZIP compatibility unchanged. Enable compression only for a measured complete path that benefits in size, latency and memory; repeat its actual read/write/corruption/recovery workload before adopting it.

## All approved features

| Feature | Full implementation scope | Dependency and acceptance |
|---|---|---|
| Ink selection and editing | Topmost click selection; lasso; add/remove/toggle membership; move; duplicate; recolor; width changes; delete; compact visible controls; one Undo per completed edit. Preserve occurrence identity, appends during pending work and owner cancellation. | Pure query/edit modules exist and have focused coverage. Surface/App adapters follow the editor memory foundation. Test actual Wacom event paths, mouse/right-click, mirror controls and large selections. |
| Tool presets and quick switching | Save, activate, explicitly update, rename and delete pen/eraser/select presets; exact color/fractional width; shared main/tablet controls; focused number shortcuts. | Isolated App integration is refreshed and focused tests pass. Repeat actual modal/keyboard/mirror/persistence checks; preserve physical/custom button maps and text/IME shortcuts. |
| Zoom, pan, fit and precision | Per-page view state; anchored zoom; bounded pan; fit/resize; straight-line drawing and angle constraints, with exact pressure/style and no canonical-geometry distortion. | Pure view/constraint modules pass focused checks. Coordinate Surface adapters after selection to avoid overlapping gesture-handler edits. Test every rotation, view switch, pending gesture and export. |
| Page overview and reordering | Background thumbnails, only visible cards/pages loaded, stable-ID selection/reorder, pointer and keyboard access, main/tablet mirror support, drawing/camera transforms and supported SVG backgrounds. | Root is wiring existing bounded components to the landed verified-file converter. No eager hydration of all pages; dirty/live models must take precedence over old disk data. |
| Large PDF/scan import | Cancellable page selection, page-by-page work, progress, bounded decoded pages and original-note insertion ownership; text-first import and OCR only when needed. | Finish foundation attachment path and integrate the prepared page-import controllers. Verify close/cancel/restart and large mixed page sets. |
| Right-pane PDF reference and Wacom markup | Useful reference navigation/fit/zoom/search; editable ink per page; Undo/Redo; durable recovery and original PDF backup; portable attached-note markup; annotated PDF export; bounded page/model caches. | Isolated feature exists. Root is preparing raw/chunked transport compatibility and has fixed synchronous full-scene capture/metadata copying and durability issues. Merge into the current foundation, then run large-document, color, recovery, source-change, cancellation and markup/export proofs. |

The withdrawn preset-layout icon request and unapproved opacity/highlighter features are outside this scope.

## Parallel work and dependency control

- Each active source owner uses explicit files and an isolated branch/worktree. Shared integration and Git index mutations are coordinated.
- Architecture owns the compact resource-ledger helper and memory attribution. The fresh investigator owns history integration/tests. Root owns the small-stroke bounds change. Drawing owns renderer packing plus Word/converter source.
- Overview uses drawing's verified file converter instead of building a second byte-transfer broker. It resumes as soon as that dependency is available.
- Selection/precision gesture adapters are queued behind the model foundation and coordinated sequentially where they touch the same Surface handlers.
- Merge one feature inward at a time. A feature branch being coded or passing pure tests does not mean it is integrated or release-ready.
- For a confirmed new issue: reproduce it, assign a concrete owner/file boundary, implement the fix, run focused regression checks, integrate serially, and rerun the affected complete scenario. Dependent tasks start immediately when prerequisites land.
- Keep work moving on independent tasks while a native slot, conversion seam or reviewer is pending. Only product decisions that cannot be inferred go back to Sean.

## Required formal review waves

### 1. First useful integrated-bundle panel

Use three fresh independent reviewers: bugs/data integrity, UI/UX and accessibility, and performance/architecture. Review core drawing plus the new presets, selection and PDF reference workflows together, including their real performance. Implement all actionable findings, repeat affected tests, then run the stable-bundle release gate. This replaces the earlier foundation-only panel before any feature integration.

### 2. Panel after all approved features

Run another independent bugs/UI-UX/performance panel over the integrated feature set and cross-feature workflows. Fix findings with the same standard, including regressions introduced by integration. Repeat affected end-to-end and performance stages.

### 3. Final three-way whole-app audit

Use three fresh reviewers, each covering the whole app rather than only their author's subsystem. Include architecture, data ownership, crash/recovery, UI/keyboard/pen interactions, performance, import/export and supported-format boundaries. Reproduce and fix every actionable finding before final source freeze.

Author checks, reciprocal code reads and the current targeted memory investigation do not substitute for these waves.

## Final release gate and delivery

The completed candidate must have all approved scope integrated and all known actionable findings resolved. Run the full suite after the requested phase is implemented, then hidden source/packaged app checks, frozen representative stress runs, recovery/soak and strict signature verification. Preserve exact test/build/source identity and local artefacts. Never push main or a release tag before preflight passes.

Finish checked work on main, push it, remove completed work branches/worktrees, and report the actual release through the existing status tooling. Notify Sean before installing the tested candidate; keep unsaved work protected and the working installation undisturbed until installation is authorised for that candidate.

Provide the requested Claude handoff **in this chat**, naming the exact commit/build, completed scope, confirmed defects fixed, same-scope before/after measurements, final review findings and closure, test/artefact evidence, and precise limits of what was actually exercised. Do not claim physical hardware delivery from synthetic pen events or native Windows execution from simulated platform checks.

## Progress reporting

Report every lettered checkpoint when reached, and give a brief whole-roadmap update at least once per hour during active work and whenever Sean requests status. Report the completed milestone, current release blockers, parallel owners/dependencies, next concrete gate and revised timing. Update this file as evidence changes the plan. Do not replace implementation with an unresolved todo list.

Detailed existing evidence: [performance investigation](/Users/example/GIT/NoteMind/docs/PERFORMANCE-AUDIT.md), [0.36 baseline bug audit](/Users/example/GIT/NoteMind/docs/BUG-AUDIT.md), and [active engineering handoff](/Users/example/GIT/NoteMind/docs/CONTINUATION.md).
