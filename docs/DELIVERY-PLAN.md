# NoteMind delivery plan

Handoff target: **8 AM Central, November 18, 2026**. Final checkpoint: 8 AM Central. See [the handoff](CLAUDE-HANDOFF.md) for final source/build identities. The objective is the best implemented, tested and reviewable state by that cutoff. Failed qualification does not become a stable release because the deadline arrives.

Installed **0.35.0** remains untouched. Candidate source is **0.37.0**. No main push, release or install has occurred. Work and findings stay in this chat and repository documents, following Sean's explicit instruction not to put them in TaskMind.

## Implemented scope

| Area | Integrated behavior |
|---|---|
| Pen and tablet | Lower physical button erase/delete; upper button selection; right-click selection; generation and heartbeat fences; temporary-tool/contact ownership; requested button tooltips. No persistent diagnostic or instructional drawing-pane prose. |
| Page correctness | Fit and resize against the measured tablet stage; paper across the writable area; inserted backgrounds; page spacing; preserved coordinates through all four rotations. |
| Ink editing | Click/lasso selection; add/remove/toggle membership; move, duplicate, recolor, width change and delete; one Undo per completed edit; safe pending-work and page ownership. |
| Presets and precision | Save, activate, update, rename and delete presets; exact color/fractional width; main/tablet controls and focused shortcuts; per-page pan/anchored zoom/fit; straight lines and angle constraints. |
| Page overview | Background thumbnails; bounded visible cards; stable-ID selection and pointer/keyboard reorder; dirty/live precedence; drawing/camera backdrops and supported SVG sources. |
| PDF and scan import | Cancellable page selection and page-by-page loading; initiating-note ownership; text-first import; bounded decoded pages; explicit progress and durability failures. |
| Right-pane PDF reference | Navigation, fit, zoom, search and Wacom markup; per-page ink Undo/Redo; durable recovery/source backup; portable attached-note markup; annotated PDF export; bounded page/model caches. |
| Persistence and lifecycle | Guarded writes, exact committed receipts, recovery/history, external-edit conflicts, scoped raw asset transport, late cancellation/worker/window loss, accepted-write shutdown barriers and retryable owned cleanup. |

The preset-layout icon request was withdrawn as belonging to another chat. Unapproved highlighter/opacity features are outside this scope.

## Qualification at this checkpoint

| Gate | Evidence and limit |
|---|---|
| Full suite | Final coherent run at `43f4569`: **3,392 passed, zero failed, zero skipped**, including original 100-JPEG history. All 1,423 before/after source hashes match. |
| Original 2M distinct dots | All five fixed pixel oracles passed; aggregate owned peak **1,008,320,512 B**; all 415 captured process IDs exited. |
| Original pressure strokes | 100,000 strokes × 20 points; five fixed pixel oracles passed; peak **887,095,296 B**; all 292 captured process IDs exited. |
| Fresh PDF reference UI | 100 pages; 22 phases passed including fit, markup Undo/Redo, navigation, cancellation, source pinning, search, export and four rotations. Peak **992,477,184 B**. |
| Large image history | Original 100 distinct 1800×2400 JPEGs passed fresh, known, unchanged and repaired CAS. Zero cumulative whole-asset materialization; one bounded 196,608-byte source read at a time. |
| Full mixed image/OCR | **Failed** at **1,142,669,312 B** during the first OCR request after all 104 display phases. Actual exit 1 and all four captured processes exited. A specific exact-byte WASM startup copy is being corrected and independently reviewed; it is not yet a whole-workload solution. |
| Active large source editor | **Failed** the memory target during native textarea layout of the original styled 16 MiB text, before counting begins. Separate counter and inactive-editor retirement checks pass. An isolated viewport-editor proof and full consumer/IME/history dependency map are in progress; no production replacement is claimed. |
| Final package | Signed builds exist at earlier source checkpoints. Final source/generated-file/package fidelity, hidden startup and affected native repeats remain required. |

All hidden tests use disposable profiles and avoid physical pen/media input and the installed application. Component/synthetic pen tests do not establish physical Wacom behavior. Source-run evidence is distinguished from packaged-runtime evidence.

The original aggregate 1 GiB, renderer 900 MiB, raw 384 MiB and free-disk 2 GiB guards remain unchanged. No reduced image/model/geometry/text workload, forced GC, cache flush, heap/thread reduction or altered pixel oracle is used to turn a failure into a pass.

## Remaining schedule and pause points

| Central time | Work | Reviewable pause point |
|---|---|---|
| 6:40–7:00 | Finish the bounded OCR startup ownership change and independent fault/concurrency review; compare exact original positive OCR fixtures. Prepare the isolated large-editor proof. Merge confirmed leaves serially. | Committed source and focused proof, with unresolved full-workload failures labelled. |
| 7:00–7:30 | Run full preflight after final implementation and generated assets; build/sign the candidate; compare source/package hashes; perform hidden startup and affected stress checks. | Green suite plus exact candidate identity, or a preserved failing gate with its actual exit and ownership proof. |
| 7:30–8:00 | Finish the highest-value remaining checks, preserve receipts, update continuation and the Claude handoff, and commit/push the appropriate checked source or WIP state. | Reproducible handoff; no false production-ready claim and no interruption of the installed app. |

Whole-timeline updates are due hourly and on request; the next is 7 AM Central. Findings are fixed by an assigned owner rather than merely listed. Dependencies resume immediately after their prerequisites merge. If a known issue remains at the cutoff, its reproduction, attempted fixes and exact qualification boundary accompany the handoff.

## Audit and integration rules

The requested review sequence covers the first useful integrated bundle, all approved features, then a fresh bugs/UI-UX/performance review of the whole app. Final independent reports are in [bugs](audit/FINAL-WHOLE-APP-BUGS.md), [UI](audit/FINAL-WHOLE-APP-UI.md), and [performance](audit/FINAL-WHOLE-APP-PERFORMANCE.md). Fresh follow-up rereads are in [bug recheck](audit/FROZEN-FINAL-BUG-RECHECK.md) and [UI recheck](audit/FROZEN-FINAL-UI-RECHECK.md). Reproduced findings receive code, focused regression tests and affected scenario repeats; a narrow reread is not counted as another entire audit.

Each feature/fix owner uses explicit files in an isolated worktree. Root merges one inward at a time. Only one heavy build/native run executes at once, at low priority, with hidden nonfocusable windows. Full suite execution follows coherent implementation; preflight precedes any main/tag push. Installed apps and user data remain outside test ownership.

## Performance work and measurement boundaries

The requested programme is to rank the top three bottlenecks at each complete pipeline stage, address them, then repeat the same workload. [Pipeline evidence](audit/PIPELINE_STAGE_RANKING_EVIDENCE.md) separates available stage measurements from missing full-path rankings. **Complete integrated top-three rankings are not yet demonstrated**; dropped or inclusive timing rows are not represented as self-CPU rankings.

| Stage | Current work and proved observations |
|---|---|
| Input/model/ink | Owned geometry/identity hydration, bounded dirty work and asynchronous erase/selection. The two original 2M-point producer scenarios above pass. |
| Load/save/history | Direct file/CAS streaming, exact scoped raw ownership, binary transfers and batched geometry reads. A matched storage-only 2M-point pair reduced load from 5,139.2 to 4,123.9 ms (19.8%); it is not a whole-App paint comparison. |
| Image transport | A matched eight-image input-only pair reduced final renderer RSS from 250.41 to 136.77 MiB and combined peak from 567,132,160 to 447,741,952 B. Exact bytes/pixels were preserved. This does not close the mixed OCR failure. |
| OCR | Exact preprocessing median improved 431.693→326.713 ms across 15 paired rounds; all 54 Float32 hashes matched. Native CPU helper experiments remain test-only: active cancellation of a Node Worker proved unsafe, and even the safer child-process full workload has not qualified. |
| Editor/search | Inactive DOM retirement and unchanged-publication guards; cancellable worker counting; invalidation-safe Find ranges. Same-fixture next-match work changed 103.8→20.9 ms with zero new ranges (one observed pair). Active huge native-editor layout remains open. |
| Word/PDF/export | Streamed media and bounded inline/paragraph/table storage; foreground PDF work proceeds during Word packaging. A matched 1.04 MB parser pair improved 1,678→1,165 ms (30.6%), with grammar/corpus parity. Final frozen package repetition remains distinct. |

Zstd was considered and benchmarked in the actual runtime. It helped large legacy geometry compression but slowed complete small fsynced writes and gave no useful JPEG benefit. Public ZIP compatibility and latency-sensitive raw extents remain unchanged; adoption requires a measured complete-path benefit.

Local receipts and logs are under `test-results/performance-0.37/`; the continuation identifies source heads and exact artifacts. Measurements retain their scope, runtime, inputs, source hashes, actual process exits and failure status.
