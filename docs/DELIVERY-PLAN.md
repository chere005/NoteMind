# NoteMind delivery plan

Updated November 18, 2026, 6 AM Central. Target handoff: **8 AM Central today**. Installed 0.35.0 is untouched. No new release is qualified, pushed to main or installed. A failed acceptance gate remains a failure at the deadline.

## Incremental timeline

| Central time | Target and reviewable pause point |
|---|---|
| Now–6:30 AM | Complete the final independent bug/UI/performance reread; integrate confirmed fixes and repeat affected checks. Final reviewers remain active. |
| 6:30–7:15 AM | Repeat coherent full preflight, build one frozen signed candidate, check exact package/source fidelity and the highest-value remaining workload/recovery gates. |
| 7:15–8 AM | Preserve final source/build/results and prepare the exact Claude handoff. Qualify a stable increment only if its required gates pass. |

These are estimates, not permission to skip tests or call failing workloads stable. The safe pause point is a committed, reproducible source checkpoint with preserved evidence. One heavy/native/build at a time; Sean's running app and data remain undisturbed. The 6 AM update was delivered; next whole-timeline report is 7 AM. No TaskMind entries for this task.

## Current checkpoint

- Corrected full preflight at `9532d90`: **3254 passed, 0 failed, 1 explicitly gated large-history case skipped**, 133.9 seconds. All1354 tracked source/test/script hashes and generated footer hash remain exact. The first failed attempt lacked declared dependencies in its environment and exposed stale ownership fixtures plus a real missing-admission cleanup bug; its failures and interventions remain preserved. Six missing declared packages were installed without lock changes; all declared dependencies resolve in the pinned runtime.
- Original distinct-grid **2,000,000-stroke producer** passes all five fixed pixel oracles and erase/Undo/Redo/discard/dirty-union/selection/disposal at `c82ca98`, **1,008,320,512 B** complete owned-process peak. Original **100,000×20 pressure** workload passes all five fixed pixel oracles at `d6d12d8`, **887,095,296 B**. Every captured owned PID exited; source/driver/geometry/heap/thread/cap facts are preserved. The first complete-tree attempt failed by638,976B while finished build tooling remained alive. The retry joins and retires that completed compiler preparation before native editor work; this is a diagnostic lifecycle correction, not an App performance gain.
- Actual classic counter Worker: exact16MiB styled source /1,935,831 words in4.5056s at747,618,304B; separate legal17MiB one-word case in213.2ms at476,889,088B. CSP, input hashes, empty native textarea and all captured process exits are exact. **Cold active16MiB textarea layout still exceeds1GiB before counting; neither isolated counter result closes it.**
- Actual native inactive-editor parity passes at473,415,680B: canonical text, backward selections, programmatic source/tab restore, unchanged visual node identity and zero MutationObserver records on unchanged publications. Find Next150k matches:103.8→20.9ms,150k→0 new ranges, one same-scope pair. Geometry repeated-point2M storage read:5.139→4.124s, exact bytes/identity, one same-scope pair. These are scoped observations, not whole-App speedups.
- Final independent whole-App bugs/UI/performance rereads are active beyond the earlier14/15finding groups. Confirmed new fixes include private drawing archive output retirement, PDF close/read/write/reopen ownership, global IME shortcut guards, source counter metadata/zoom invalidation, legalApp50MiB counter/print admission, nested packed-parser retirement and missing-lease cleanup. Notes-index byte retirement/data-loss and PDF workspace suspension/reactivation leaves remain assigned until integrated and checked.
- Candidate `5f9fda9` is signed but predates latest Root fixes. Production Web original100 mixed gate at `8fa9d856` fails1,092,501,504B; experimental FILE+COLD native at `5f9fda9` fails1,091,354,624B on first inference. No native backend adoption or new installation. A newly identified **test-preparation hash stream** allocates many fresh buffers before the App starts; a causal verification-only pair is being prepared before drawing further whole-App memory conclusions.
- Complete integrated per-stage top-three rankings and final-source package/stress/recovery/soak qualification remain open. Installed0.35.0 is untouched; Root App lazy-assets default remainsOFF, qualification candidateON. Source metadata0.37.0 is not a release qualification.

## Latest measured state

- Ordinary Word native12-phase acceptance passed at source2e38f41c,603,095,040B peak, exact legacy paper/crop pixels and real link/selection/source-bound conversion/recovery/actual worker cleanup.
- Original100-image Word acceptance passed at c5c063bf/e570runtime:101 original/recovery proofs, exact source SHA, frozen CPU pixels, default-display parity and1800×2400 dimensions. Typing max3ms; final close41.7ms; all worker/file cleanup passed. Peak1,072,431,104B includes101 independent oracle renderer lifetimes and is only1,310,720B below the unchanged1GiB guard. The separately labelled product-only diagnostic passed at751,779,840B. No whole-app or mixed-OCR acceptance is inferred.
- Original477MiB XML/16MiB formatted-text reference now passes all1893 fragments, exact16,777,201 plain bytes/hash/styles/Unicode/spacing, end reachability, typing and cleanup at941,670,400B. Earlier256KiB text shaping failed at1,134,952,448B. Visible text is now bounded at16KiB; source/wire/document limits and content are unchanged. Cleanup took12s; a measured quadratic journal parsing fix is integrated next.
- Original2M-row table now passes the complete unchanged workload at `d6aa102b`:3907 fragments, all2M rows/hash/styles/cells/end reachability, at mostfive loaded,16,018,459px maximum scroll extent,1,034,059,776B peak and1.454s final worker/private-file close. Visible fragments are bounded at512 rows/4096 nodes and retired placeholders at4096px.600s table harness traversal deadline alone compensates for3907 assertions; product1GiB/20sclose guards and all content are unchanged.
- The40MP TIFF converter/native-pixel gate `5a2225be` passes at852,869,120B: original160,000,166-byte source, borrowed SHA unchanged, actual converter exit and exact160MB orientation-6 bitmap against independent nativeImage. This is converter evidence, not a full40MP Word App measurement. Exact Word/TIFF drivers, oracles and checkpoint are preserved in Root; reports remain locally under `test-results/performance-0.37/`.
- Renderer source references, current/history/pending captures, source-file authority, Main capability and callback/chunk ownership, replacement-worker receiver debt and OCR continuation are integrated. Focused actual preload/Main/archive-worker checks pass. Independent rereads closed late restore publication after final-unpin owner loss, and28 source-space/file cases pass the shared2GiB floor/concurrent admission proof. **Lazy App opt-in remains OFF on Root**, enabled only on isolated qualification branch28c568d0.
- The rebuilt production Web backend's original 100-image mixed run at frozen candidate `36b1dec3` still fails the unchanged 1 GiB guard during first inference: 1,116,815,360 B, after all 104 display/typing/autosave/tab-return phases complete. The safe experimental native-process version completes three real 25-line replies, then fails at the fourth start at 1,078,558,720 B including its 16 MiB sampler reserve. A fresh-renderer conversion experiment fails earlier at 1,118,666,752 B; its higher Main baseline defeats the proposed improvement. None is a whole-pipeline pass. Exact reports, source/runtime hashes and actual captured-process exit checks are preserved under `test-results/performance-0.37/`; only proved-stopped disposable profiles were removed.
- Causal bridge-only measurement reproduces renderer growth without canvas, bitmap or OCR: eight original JPEG inputs and fresh 17.28 MB outputs leave logical maps empty but renderer RSS grows from 87.11 to 229.61 MiB. Binary output eliminates 184,320,000 output base64 characters and improves this stage's wall time by about 70.8%, but does NOT demonstrate a memory gain: the binary run's final renderer is 231.78 MiB and combined peak 589.73 MB versus the old 586.30 MB. Exact input/output hashes and both copies' retirement receipts pass. The merged protocol through Root 3184e81 closes transient begin/read/ACK/release loss, late Main clones, expiry failure and malformed receiver ownership; Root independently reran 55 pinned checks. Default borrowed conversion paths and image kernels remain unchanged. The original 14-pixel gate and input-only causal repeat subsequently passed; the separate private-input decoder measurement below is the proved memory improvement.
- Public OCR source/decode/model admission and sender-scoped transport receipts are integrated. Actual hidden Main/preload/model gate at 7397b113 exits 0, peak 796,262,400 B: all three original fixture results exact, all three model workers actually exit, cancellation against the full raw pool sends no large payload, and final external working bytes are zero. Root's latest integrated title/history check passes 41 cases. Main close now observes asynchronous document/PDF cleanup rather than leaving abort rejections unhandled.
- Exact preprocessing improves median stage time from 431.693 to 326.713 ms across 15 paired rounds, with all 54 Float32 hashes unchanged; temporary allocation falls from 46,694,400 to 23,347,212 B. Capacity waiting falls from 599 failed worker RPCs to one in the same 50 ms saturated-pool experiment. Reusing fresh title/history serialization changes two conversions to one, with exact text/history/title. These are stage measurements, not whole-app speedup claims.
- Native CPU OCR remains test-only. It lowers the cold four-image diagnostic peak from 597,704,704 to 374,603,776 B and total time from 6047.68 to 4751.36 ms, with exact text/geometry but different floating-point outputs. An isolated active-cancellation test then confirms that terminating its Node Worker can abort the hosting process. That architecture is rejected. The binding-free parent and owned helper-process prototype subsequently passes eight isolated lifecycle cases at 457,654,272 B, including actual active-call cancellation and helper exits. It remains test-only; no product native dependency, backend or OS minimum has changed. The rebuilt production Web and safe-process full-100 results above remain failures.
- The feature bugs, UI and performance reports are integrated; the UI panel closed 11 reproduced pointer/focus/IME/initiating-note findings. See `FEATURE-PANEL-UI-REVIEW.md` and `FEATURE-PANEL-PERFORMANCE-REVIEW.md` for exact coverage and limits. Final three fresh whole-app audits, coherent full preflight and frozen source/package gates remain required.
- The next independent read reproduced additional final-quit and pending-write races. Root now joins document exports through their output receipts, rejects new work after disposal while retaining late OCR transport cleanup, joins print creation/consumers and retryable file cleanup, retains PDF source consumers through ink/export/owner destruction, and preserves archive retirement retry authority after real I/O failure. Focused exact-source failures were reproduced before each leaf; affected checks pass after integration. Sheet/core shutdown ordering, retryable final archive-directory removal and guarded PDF publication are now integrated with focused fault evidence. Notes producer stop and later asset retirement were added in a separate integrated dependency leaf. These narrow reads do not substitute for the three fresh whole-app audits.
- The private input decoder now uses native base64 conversion only for the owned raster host, with the borrowed/default decoder unchanged. Same-source eight-image input-only runs preserve all SHA values and lower final renderer RSS from 250.41 to 136.77 MiB and combined peak from 567,132,160 to 447,741,952 B. Stage median falls from 73.166 to 21.371 ms. These are bridge-stage gains; first-drain RSS falls only 33.63 MiB and the full mixed workflow still fails. The original 14 native pixel cases pass byte-exact at source `7527e5f`, with all captured processes exited. Independent 4,402-case decoder parity has zero differences.
- Root through `7c5abf6` integrates the extra publication/shutdown and PDF/menu/document interaction leaves. The integrated affected group passes 144 pinned-runtime focused tests; 15 separate archive input/retirement tests also pass. The preview fixture now joins its exact owner-destruction cleanup receipt rather than assuming filesystem completion within 20 event-loop turns. Remaining confirmed sweep leaves are still assigned. These extra sweeps do not count as the final fresh three-way audit.
- Active owners: Root independent review, integration and native scheduling; extra bugs and UI sweep owners finishing their leaves; native-runtime owner safe process input/memory causality and an unreturned spool-initialization cleanup fault. One heavy/native/build at a time, nice15, hidden nonfocusable windows, no pen/media or installed-app interference.

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
