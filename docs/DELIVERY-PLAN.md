# NoteMind delivery plan

Updated November 18, 2026, 1:25 AM Central. Target handoff: **8 AM Central today**. These are working targets; a failing gate remains active work. Installed 0.35.0 is untouched. No release is qualified, pushed to main or installed.

## Incremental timeline

| Central time | Target and reviewable pause point |
|---|---|
| Now–2 AM | Finish the image-output transfer fix and its exact-pixel/memory checks; repeat the original 100-image workflow with production Web OCR. Complete feature-panel integration. Independently investigate process-isolated native OCR without changing the product backend. |
| 2–4 AM | Three fresh whole-app auditors, independent of implementation; assign and close fixable findings. |
| 4–7 AM | Full preflight after coherent implementation, exact source/package fidelity, frozen large-image/stroke/PDF/import/export, recovery/cancellation and soak runs. |
| 7–8 AM | Exact source/build/artifact handoff for Claude, measured before/after results and truthful limits. |

Each increment needs a committed source checkpoint, focused evidence and a known safe pause point. A development package is not a stable release. Preserve Sean's running app and data; notify before a tested install. Next whole-timeline report: 2 AM, then hourly and whenever requested. Findings remain assigned until resolved; do not send them to TaskMind.

## Latest measured state

- Ordinary Word native12-phase acceptance passed at source2e38f41c,603,095,040B peak, exact legacy paper/crop pixels and real link/selection/source-bound conversion/recovery/actual worker cleanup.
- Original100-image Word acceptance passed at c5c063bf/e570runtime:101 original/recovery proofs, exact source SHA, frozen CPU pixels, default-display parity and1800×2400 dimensions. Typing max3ms; final close41.7ms; all worker/file cleanup passed. Peak1,072,431,104B includes101 independent oracle renderer lifetimes and is only1,310,720B below the unchanged1GiB guard. The separately labelled product-only diagnostic passed at751,779,840B. No whole-app or mixed-OCR acceptance is inferred.
- Original477MiB XML/16MiB formatted-text reference now passes all1893 fragments, exact16,777,201 plain bytes/hash/styles/Unicode/spacing, end reachability, typing and cleanup at941,670,400B. Earlier256KiB text shaping failed at1,134,952,448B. Visible text is now bounded at16KiB; source/wire/document limits and content are unchanged. Cleanup took12s; a measured quadratic journal parsing fix is integrated next.
- Original2M-row table now passes the complete unchanged workload at `d6aa102b`:3907 fragments, all2M rows/hash/styles/cells/end reachability, at mostfive loaded,16,018,459px maximum scroll extent,1,034,059,776B peak and1.454s final worker/private-file close. Visible fragments are bounded at512 rows/4096 nodes and retired placeholders at4096px.600s table harness traversal deadline alone compensates for3907 assertions; product1GiB/20sclose guards and all content are unchanged.
- The40MP TIFF converter/native-pixel gate `5a2225be` passes at852,869,120B: original160,000,166-byte source, borrowed SHA unchanged, actual converter exit and exact160MB orientation-6 bitmap against independent nativeImage. This is converter evidence, not a full40MP Word App measurement. Exact Word/TIFF drivers, oracles and checkpoint are preserved in Root; reports remain locally under `test-results/performance-0.37/`.
- Renderer source references, current/history/pending captures, source-file authority, Main capability and callback/chunk ownership, replacement-worker receiver debt and OCR continuation are integrated. Focused actual preload/Main/archive-worker checks pass. Independent rereads closed late restore publication after final-unpin owner loss, and28 source-space/file cases pass the shared2GiB floor/concurrent admission proof. **Lazy App opt-in remains OFF on Root**, enabled only on isolated qualification branch28c568d0.
- The production Web backend's original 100-image mixed run still fails the unchanged 1 GiB guard during first inference, after all display/typing/autosave/tab-return phases complete. A later experimental native-worker run completes seven real 25-line replies before exceeding the same guard. Neither is a whole-pipeline pass. Exact reports, source receipts and actual process-exit checks are preserved; only proved-stopped disposable profiles were removed.
- Causal bridge-only measurement reproduces renderer growth without canvas, bitmap or OCR: eight original JPEG inputs and fresh 17.28 MB outputs leave logical maps empty but renderer RSS grows from 87.11 to 229.61 MiB. The old output bridge allocates 184,320,000 base64 characters. Architecture's bounded binary output/ACK leaf has 45 pinned-runtime focused passes; Root's independent review found transient lost-reply reconciliation and timer-cleanup cases to close before native qualification. Default borrowed conversion paths and all image kernels remain unchanged.
- Public OCR source/decode/model admission and sender-scoped transport receipts are integrated. Actual hidden Main/preload/model gate at 7397b113 exits 0, peak 796,262,400 B: all three original fixture results exact, all three model workers actually exit, cancellation against the full raw pool sends no large payload, and final external working bytes are zero. Root's latest integrated title/history check passes 41 cases. Main close now observes asynchronous document/PDF cleanup rather than leaving abort rejections unhandled.
- Exact preprocessing improves median stage time from 431.693 to 326.713 ms across 15 paired rounds, with all 54 Float32 hashes unchanged; temporary allocation falls from 46,694,400 to 23,347,212 B. Capacity waiting falls from 599 failed worker RPCs to one in the same 50 ms saturated-pool experiment. Reusing fresh title/history serialization changes two conversions to one, with exact text/history/title. These are stage measurements, not whole-app speedup claims.
- Native CPU OCR remains test-only. It lowers the cold four-image diagnostic peak from 597,704,704 to 374,603,776 B and total time from 6047.68 to 4751.36 ms, with exact text/geometry but different floating-point outputs. An isolated active-cancellation test then confirms that terminating its Node Worker can abort the hosting process. That architecture is rejected. A binding-free parent and owned helper-process prototype is assigned; no product native dependency, backend or OS minimum has changed. First repeat the large-image gate with production Web OCR after the bridge fix.
- The feature bugs, UI and performance reports are integrated; the UI panel closed 11 reproduced pointer/focus/IME/initiating-note findings. See `FEATURE-PANEL-UI-REVIEW.md` and `FEATURE-PANEL-PERFORMANCE-REVIEW.md` for exact coverage and limits. Final three fresh whole-app audits, coherent full preflight and frozen source/package gates remain required.
- Active owners: Root independent review, integration and native scheduling; architecture binary-output ownership and causal memory checks; native-runtime owner safe process transport/lifecycle prototype. One heavy/native/build at a time, nice15, hidden nonfocusable windows, no pen/media or installed-app interference.

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
| Ink selection and editing | Topmost click selection; lasso; add/remove/toggle membership; move; duplicate; recolor; width changes; delete; compact visible controls; one Undo per completed edit. Preserve occurrence identity, appends during pending work and owner cancellation. | Source and Surface/App interaction paths are integrated, including large/sparse history ownership and exact geometry. The independent feature UI panel reviewed every listed action and closed selected-width IME ownership. Frozen integrated/package and scale repeats remain release gates. |
| Tool presets and quick switching | Save, activate, explicitly update, rename and delete pen/eraser/select presets; exact color/fractional width; shared main/tablet controls; focused number shortcuts. | Integrated at `9759c71`: 34 focused tests, 14 actual modal/keyboard/mirror UI checks and App/PadHost lifecycle pass. Preserve coverage in later feature and packaged checks. |
| Zoom, pan, fit and precision | Per-page view state; anchored zoom; bounded pan; fit/resize; straight-line drawing and angle constraints, with exact pressure/style and no canonical-geometry distortion. | Adapters integrated at `09c0743` pass 63 focused integration checks; isolated `0d64315` passes 42 actual hidden workflows. Retain rotation, owner switching, pending gesture and export coverage. |
| Page overview and reordering | Background thumbnails, only visible cards/pages loaded, stable-ID selection/reorder, pointer and keyboard access, main/tablet mirror support, drawing/camera transforms and supported SVG backgrounds. | Drawing/camera/source adapters and verified-file thumbnail conversion are integrated. The earlier3000-page native host keeps30 cards mounted; the fresh panel closed foreign-pointer cancellation and exercised reorder/mirror ownership. Preserve dirty/live precedence and repeat on the frozen final build. |
| Large PDF/scan import | Cancellable page selection, page-by-page work, progress, bounded decoded pages and original-note insertion ownership; text-first import and OCR only when needed. | Direct File import, page controllers, attachment/scan source references and initiating-note ownership are integrated. Earlier100-page native PDF/scan gates and affected cancellation/range/budget tests pass; public OCR reserve/consume ownership is being strengthened before frozen cross-feature repeats. |
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
