# NoteMind delivery plan

Updated November 17, 2026, 11 PM Central. Target handoff: **8 AM Central, November 18**. These are working targets; a failing gate remains active work. Installed0.35.0 is untouched. No release is qualified, pushed to main or installed.

## Incremental timeline

| Central time | Target and reviewable pause point |
|---|---|
| Now–midnight | Finish source/receiver lifetime and mixed image/OCR integration; close huge Word layout/scroll/cleanup defects; qualify a stable increment when its exact gates pass. |
| Midnight–2 AM | Complete useful-bundle review and the feature-inclusive bugs/UI/UX/performance panel; fix findings and repeat affected workflows. |
| 2–4 AM | Three fresh whole-app auditors, independent of implementation; assign and close fixable findings. |
| 4–7 AM | Full preflight after coherent implementation, exact source/package fidelity, frozen large-image/stroke/PDF/import/export, recovery/cancellation and soak runs. |
| 7–8 AM | Exact source/build/artifact handoff for Claude, measured before/after results and truthful limits. |

Each increment needs a committed source checkpoint, focused evidence and a known safe pause point. A development package is not a stable release. Preserve Sean's running app and data; notify before a tested install. Next whole-timeline report: midnight, then hourly and whenever requested. Findings remain assigned until resolved; do not send them to TaskMind.

## 11 PM measured state

- Ordinary Word native12-phase acceptance passed at source2e38f41c,603,095,040B peak, exact legacy paper/crop pixels and real link/selection/source-bound conversion/recovery/actual worker cleanup.
- Original100-image Word acceptance passed at c5c063bf/e570runtime:101 original/recovery proofs, exact source SHA, frozen CPU pixels, default-display parity and1800×2400 dimensions. Typing max3ms; final close41.7ms; all worker/file cleanup passed. Peak1,072,431,104B includes101 independent oracle renderer lifetimes and is only1,310,720B below the unchanged1GiB guard. The separately labelled product-only diagnostic passed at751,779,840B. No whole-app or mixed-OCR acceptance is inferred.
- Original477MiB XML/16MiB formatted-text reference now passes all1893 fragments, exact16,777,201 plain bytes/hash/styles/Unicode/spacing, end reachability, typing and cleanup at941,670,400B. Earlier256KiB text shaping failed at1,134,952,448B. Visible text is now bounded at16KiB; source/wire/document limits and content are unchanged. Cleanup took12s; a measured quadratic journal parsing fix is integrated next.
- Original2M-row table identified27,586 elements perold fragment;512-row/4096-node fragments close that layout burst. The full rerun then reached33,554,432px physical scroll extent at fragment2185, admitting69 fragments. Retired placeholder height is now capped at4096px; the unchanged all-row/end/≤8loaded/1GiB/20sclose repeat is pending a short development build.600s table harness deadline compensates for3907 exact traversal assertions; it does not relax product responsiveness or memory/cleanup guards.
- Renderer source-reference consumers, current/history/pending captures, source-file authority, Main capability and callback/chunk ownership are integrated with focused checks, including actual preload/Main/archive-worker boundaries. Independent reads closed source metadata dedup, outstanding IPC chunk cancellation, unpublished picker/attachment scopes and OCR input-continuation defects. **Lazy App opt-in remains disabled** until replacement-worker receiver debt and all consumers are integrated and natively qualified.
- Private exactRGBA index→OCR and owned ORT scratch lifetime are integrated. Native14-case Node PNG authority passed exact channels/dimensions/P3/allEXIF at843,874,304B, with all actual worker exits. Full original100-image automatic indexing plus real positive recognition and final model/raw drain remains required. The previous CPU/early-lifetime mixed run still failed at1,080,688,640B before OCR completion; no new whole-pipeline gain is claimed.
- Active owners: Root integration/editing/PDF/history/retention/native schedule; architecture receiver/session/viewport/mixed-driver boundaries; performance replacement-worker external-debt accounting; data huge Word layout/scroll/cleanup and40MP TIFF proofs. One heavy/native/build at a time, nice15, hidden nonfocusable windows, no pen/media or installed-app interference.

## Release and dependency order

Merge isolated feature/fix leaves inward one at a time. Complete dependencies before starting dependent native acceptance. Full preflight runs after implementation is coherent. The three formal review waves below remain required; author/reciprocal affected-file reads do not substitute for them. Fresh final reviews must examine the integrated feature set and follow fixes through retesting.

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
| Ink selection and editing | Topmost click selection; lasso; add/remove/toggle membership; move; duplicate; recolor; width changes; delete; compact visible controls; one Undo per completed edit. Preserve occurrence identity, appends during pending work and owner cancellation. | B1 actual Surface/App integration is saved at `62e54b2`, with 15 actual interaction checks and focused regressions passing. B2 gesture, recolor/width and large-selection coverage continues in parallel with core memory work. |
| Tool presets and quick switching | Save, activate, explicitly update, rename and delete pen/eraser/select presets; exact color/fractional width; shared main/tablet controls; focused number shortcuts. | Integrated at `9759c71`: 34 focused tests, 14 actual modal/keyboard/mirror UI checks and App/PadHost lifecycle pass. Preserve coverage in later feature and packaged checks. |
| Zoom, pan, fit and precision | Per-page view state; anchored zoom; bounded pan; fit/resize; straight-line drawing and angle constraints, with exact pressure/style and no canonical-geometry distortion. | Adapters integrated at `09c0743` pass 63 focused integration checks; isolated `0d64315` passes 42 actual hidden workflows. Retain rotation, owner switching, pending gesture and export coverage. |
| Page overview and reordering | Background thumbnails, only visible cards/pages loaded, stable-ID selection/reorder, pointer and keyboard access, main/tablet mirror support, drawing/camera transforms and supported SVG backgrounds. | Root is wiring existing bounded components to the landed verified-file converter. No eager hydration of all pages; dirty/live models must take precedence over old disk data. |
| Large PDF/scan import | Cancellable page selection, page-by-page work, progress, bounded decoded pages and original-note insertion ownership; text-first import and OCR only when needed. | Finish foundation attachment path and integrate the prepared page-import controllers. Verify close/cancel/restart and large mixed page sets. |
| Right-pane PDF reference and Wacom markup | Useful reference navigation/fit/zoom/search; editable ink per page; Undo/Redo; durable recovery and original PDF backup; portable attached-note markup; annotated PDF export; bounded page/model caches. | Integrated at `de299dc` with actual raw/chunked source and markup paths, 100-page navigation/search/import/export and actual pen/host ownership proof. Finish large-document/markup, kernel lease cleanup and cross-feature foreground responsiveness before release. |

The withdrawn preset-layout icon request and unapproved opacity/highlighter features are outside this scope.

## Parallel work and dependency control

- Each active source owner uses explicit files and an isolated branch/worktree. Shared integration and Git index mutations are coordinated.
- The first data panel has passed after three ownership fixes. The first UI role has passed; performance owns full-App identity/load preparation, architecture owns coordinate-correct renderer stress and real IPC repeats, data owns large-image transfer ownership, and Root integrates serially and owns release validation.
- Overview uses drawing's verified file converter instead of building a second byte-transfer broker. It resumes as soon as that dependency is available.
- Precision gesture adapters are integrated at `09c0743`. Further Surface changes remain serially owned; memory work continues independently.
- Merge one feature inward at a time. A feature branch being coded or passing pure tests does not mean it is integrated or release-ready.
- First-candidate priority: actual 2M producer + real lazy load/save gates, PDF kernel lease closure, scoped fresh bugs/UI/performance panel, full affected release validation and packaging. Additional feature/optimization work remains explicitly queued behind these dependencies.
- Word final packaging/ZIP must release the raw-CAS/document-request lane once media is safely spooled: otherwise a large export can queue foreground PDF requests. Drawing owns this immediately after its compact-inline boundary gate, with a Root-authored concurrency regression.
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

The first candidate must have its stated increment implemented, all critical findings for that increment resolved, and its required first panel/release gate passed. The final programme candidate must have all approved scope integrated and all known actionable findings resolved. Run the full suite after the requested phase is implemented, then hidden source/packaged app checks, frozen representative stress runs, recovery/soak and strict signature verification. Preserve exact test/build/source identity and local artefacts. Never push main or a release tag before preflight passes.

Finish checked work on main, push it, remove completed work branches/worktrees, and report the actual release through the existing status tooling. Notify Sean before installing the tested candidate; keep unsaved work protected and the working installation undisturbed until installation is authorised for that candidate.

Provide the requested Claude handoff **in this chat**, naming the exact commit/build, completed scope, confirmed defects fixed, same-scope before/after measurements, final review findings and closure, test/artefact evidence, and precise limits of what was actually exercised. Do not claim physical hardware delivery from synthetic pen events or native Windows execution from simulated platform checks.

## Progress reporting

Report every lettered checkpoint when reached, and give a brief whole-roadmap update at least once per hour during active work and whenever Sean requests status. Report the completed milestone, current release blockers, parallel owners/dependencies, next concrete gate and revised timing. Update this file as evidence changes the plan. Do not replace implementation with an unresolved todo list.

Detailed existing evidence: [performance investigation](/Users/example/GIT/NoteMind/docs/PERFORMANCE-AUDIT.md), [0.36 baseline bug audit](/Users/example/GIT/NoteMind/docs/BUG-AUDIT.md), and [active engineering handoff](/Users/example/GIT/NoteMind/docs/CONTINUATION.md).
