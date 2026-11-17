# NoteMind delivery plan

Updated November 17, 2026, 4:07 PM Central. This is the active plan for the whole requested scope, including the next stable increment, all approved features, and every required review round.

## Incremental timeline and priorities

Revised after Sean's request to make progress visible sooner and review the features together with performance work. **Feature integration starts now.** Foundation memory/export fixes stay actively owned in parallel; the broad review is moved onto the first useful feature bundle instead of waiting for a separate foundation-only audit.

Sean rejected the multi-day delivery wait. The immediate target is now a **tested first stable increment in 3–6 hours from the November 17, approximately 1:32 PM Central decision** (approximately 4:30–7:30 PM Central). The go/no-go update was delivered at 2:29 PM Central: source was not ready to install because edited-drawing saves still crossed the resource cap. The coordinate-correct standalone producer passes; the actual App plus IPC workflow with two million distinct strokes still exceeds the unchanged memory guard during edited saving. These are separate gates.

Prioritize the drawing/pen/page/crash fixes, the already integrated useful features and their scoped first review/release gate. Finish independent critical ownership fixes in parallel. Deliver the rest as smaller reviewed increments; preserve every approved feature and required audit wave. The previous 48–84-hour monolithic finish estimate is superseded as the delivery strategy. Source checkpoints remain recoverable and do not interrupt the installed app.

| Checkpoint | Status / next bounded increment | Visible result and pause point |
|---|---|---|
| **A — tools and presets** | **Complete: `9759c71`** | Integrated presets and quick switching; 34 focused tests, 14 main/tablet UI checks and the production drawing-host lifecycle check pass. Recoverable source checkpoint. |
| **B1 — useful ink selection** | **Complete: `62e54b2`** | Integrated occurrence selection, delete, duplicate and compact controls; 15 hidden Surface interaction checks and 58 focused checks pass. Recoverable source checkpoint. |
| **B2a — full selection interactions** | **Functional source: `a3c64fe`** | Lasso, move, recolor, width and nudge pass 24 small-Surface interactions and 45 focused author checks. |
| **B2b — selection at scale** | **Active, alongside features** | Sparse style/delete/duplicate accounting is integrated at `48cef64` after independent review and 65 focused checks; memory and renderer owners address the actual 2M-stroke producer and lazy reopen. Pause after exact edit/Undo/save evidence, not a worker-only pass. |
| **C1 — useful PDF reference** | **Integrated checkpoint: `de299dc`** | Strict 100-page hidden workflow passes 13 recorded phases, all four export rotations, native-text import and cancellation; zero runtime warnings/errors, sampled combined peak 949,878,784 bytes with actual scoped markup transport. |
| **C2a — PDF host lifecycle** | **Integrated checkpoint: `de299dc`** | Actual App/PadHost checks preserve source, ink, Undo and pending saves across host moves; close waits for save/open completion. The real width-prop and resize-loop defects are fixed. |
| **E1 — precision drawing** | **Integrated checkpoint: `09c0743`** | Anchored zoom, pan, fit, straight lines and angle constraints pass 42 hidden UI workflows with zero runtime errors. 63 focused integration checks pass; its 42-workflow author UI gate is retained for the combined bundle. |
| **C2b — PDF command and save ownership** | **Complete in `de299dc`** | Actual App/PadHost passes active-PDF next/previous, clear-markup/Undo and preserved hidden camera ink, plus pending-save/open/portal ownership. Six recorded phases; zero runtime warnings/errors. |
| **C2c — PDF transport and supported scale** | **Transport integrated; supported-scale and lease gates active** | Raw markup save/reopen uses the existing scoped chunk transport and archive worker. Actual 2.4 MB pressure-markup roundtrip has no Main whole-byte borrow. The strict 100-page workflow passes. Worker-loss lease cleanup and large supported workloads remain actively assigned. |
| **D1 — page overview** | **Integrated: `42754e3`** | Actual App/PadHost eight-phase workflow passes camera reorder, portal ownership, hidden-command suspension and 3,000 pages with 30 mounted cards at 809,402,368 B sampled peak. Real >2 MiB SVG preview/color/cancellation gate passes at 569,180,160 B. 63 focused integrated checks pass. |
| **D2 — large import** | **After its shared PDF/attachment seam** | Cancellable page selection and page-by-page text-first import; retain exact insertion ownership. Separate recoverable checkpoint. |
| **First stable bundle** | **Target 3–6 hours from the 1:32 PM decision** | First data panel passed23fa66b; first UI panel passed5bce336 with101 focused cases and actual App9-phase/presets17-check/PDF14-phase gates. Data extensions passed Word publication/shutdown, private archive retirement and Word column widening. Coordinate-correct pressure and2M producer now both exit0 with original pixels. Full-App identity, large-image transport, repeats and packaged gates remain active. Resolve repeated drawing native-memory and all fresh findings, then freeze, preflight, package and verify; notify before installation. |
| **All-feature panel** | **Subsequent reviewed increments** | Review all approved features together, implement findings, and repeat affected end-to-end/performance stages. |
| **Final audits and release** | **After all approved scope passes** | Three fresh whole-app audits; resolve findings; frozen stress/recovery/soak, full packaged validation and Claude handoff. |

The next source increments target roughly **30–90 minutes each**, with a status report if a gate exposes a larger defect. Independent lanes overlap; these are not durations to add. A source pause point is committed and recoverable. An installable increment additionally passes its review and release gates.

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
| Editor decode and actual reopen | Architecture owner + performance reviewer | Coordinate-correct producer pressure100k×20 and2M unique grid strokes retain all17 phases/all5 original pixel hashes. Actual App alias2M gate passes12 independent public-JSON signatures: native lift453.3→53.8ms, tail erase451.5→45.9ms, Save max gap71.7→34.1ms; this uses repeated occurrences, not2M distinct objects. Actual distinct2M App+IPC still fails erase-save at1,075,707,904B on`53d314a`. | Renderer private ID capture is integrated; backend full ID destination is replaced at`a4805b1`,34 focused cases pass. Same exact unique-grid native repeat is active. Preserve full independent fresh-worker geometry and identity hashes. |
| Sparse edit history | Root | Sparse history integrated at `48cef64`. Wider leaf pages at `2c3b40a` pass 52 focused history/model checks, including leaf/internal boundaries, aliases, cancellation and complete Undo. Installed producer heap falls 261.51 MB to 244.75 MB in the same 2M workload. | Run the actual large-selection scenario. Movement geometry and large batches remain included in acceptance. |
| Renderer worker storage | Fresh memory owner | Compact offsets, dot bounds, affine IDs, private locator retirement and dense tiling are integrated through `6b1e7cb`. Actual full/dirty pixel hashes now match after repeated erasure; full edit/Undo cap acceptance remains active. | Finish the entire producer edit/Undo/Redo/selection gate, then preserve it through real IPC save/reopen and combined feature validation. |
| Word export and import | Root; independent data extensions passed | Dedicated packaging, Main-owned publication and full shutdown join integrated through `e2cb7d7`;51 integrated focused cases pass. Actual PDF foreground read completes10.05ms during4MiB Word packaging. Actual16MiB inline caller passes exact477,804,840-byte XML CRC/count at970,129,408 B after private column narrowing, versus1,056,096,256 B before narrowing. Wall time33.13s versus31.05s; memory gain only, not a wall-speed claim. | Preserve independent fault/semantic checks and repeat frozen/packaged full caller plus mixed/table scenarios. Import/cold-start scheduling follows in the next increment. |
| Large-image opening and transport | Performance owner + Root | File-backed inspection, binary chunk ACKs, private buffer retirement and idle media gating are integrated. Source `b5268af` opens all100 JPEG references in867ms with one1.48MB viewport Blob and Main heartbeat below7ms, but editing still crosses the unchanged1GiB guard at1,080,360,960B. No complete pipeline pass. | Implement owned immutable raw disk spools with exact tokens and bounded reads, then streamed Main save/recovery publication. `ae98b1c` writer passes16 focused compatibility/ownership/failure cases; native and production integration remain required. |
| PDF reference | Root, with lease cleanup assigned to drawing after its Word checkpoint | Integrated `de299dc`: strict actual raw-path 100-page and actual host/pen-command checkpoints pass; focused PDF/doc/archive integration checks pass after independent targeted ownership read. | Kernel lease cleanup and actual worker-exit/cleanup barriers are integrated at `136d89c`; 43 focused integrated ownership/recovery cases pass. Preserve these in combined native gates and close remaining supported-scale/foreground contention findings. |
| Precision feature | Architecture owner authored; Root integrated | 42 actual hidden workflows and 59 combined focused checks pass on `0d64315`, including exact pressure, anchored view, one Undo and runtime-error channels. | Integrated at `09c0743`; preserve tests through PDF integration and the first broad panel. |
| Page overview | Root; first UI role complete | Latest-intent owner epochs, keyboard reorder/tab focus, preset modal focus and PDF dual-view Fit are integrated through `8421d36`. Independent actual App9-phase and17 preset checks pass;100-pagePDF14 stages pass with zero runtime errors/warnings. Overview owned SVG/chunk cancellation fixes are integrated. | Repeat production-loader SVG native proof after private handoff fixes, preserve App ownership evidence in the combined feature build, then packaged validation. |
| Scan colors and normalization lifetime | Existing committed foundation; final integration gates remain | Expanded 20-case managed-color oracle matches source/copied helpers; private normalization workers and packet release have focused ownership coverage. | Preserve source semantics through feature merges and repeat frozen packaged coverage. |

The first data and UI roles have completed their stated bundle scope; later targeted extensions do not certify the all-feature panel or the final whole-app audits.

Close safety is also active: edits arriving during a long sheet save must be included before the scoped close ACK. Rich notes already participate in camera-flush; the remaining issue is quiescence across later edits and accepted metadata intents. The data reviewer owns the reproduction, drain and cancellation proofs.

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
