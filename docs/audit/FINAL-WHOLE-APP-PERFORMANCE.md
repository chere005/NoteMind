# Final fresh whole-app performance and architecture audit

Independent fresh reviewer, November 18, 2026. Initial source: `aa29c7c`; later source includes Root through `418d11b` and the isolated leaves below. This is the third fresh performance/architecture breadth review. The installed application and user data were not touched. This report does not certify a release, declare the app free of bugs, or close the failing mixed image/OCR gate.

## Actual coverage

The review followed production ownership and scheduling across the whole application, rather than treating the active OCR investigation as the whole audit:

- Drawing/contact/editing: `TabletSurface`, `CameraInk`, `inkRenderer`, selection query/work/edit helpers, immutable history/resource accounting, save queue, current/dirty model caches, lazy load and page overview source/coordinator/thumbnail worker.
- Notes: current/source/history/title capture, visual/Markdown edits, Find/Replace, footer, tab/view changes, image previews and URL owners, attachment thumbnail queue and programmatic insert/import paths.
- PDF: provider/session/cache, source/service/jobs/export consumers, text/raster cancellation, page import and background indexing seams. `PDFIndexReader` is currently unreferenced by production modules; its source was read without promoting its unused behavior into an app defect.
- Word/scan/print: source/import streaming, bounded reference builder/sessions, semantic Markdown/packed inline parsing, export media/workers/publication, TIFF ownership, scan spooling/writer/admission, print source discovery and file leases.
- IPC/resources/idle: document conversion/disposal, raw-capacity notifications and waits, index foreground/background scheduling, transport/worker cleanup, cache bounds and conditional timers/animation frames. Footer polling was reproduced; conditional pen watchdogs and active PDF selection tracking were not falsely labelled idle leaks.
- Cross-feature behavior: current/history/pending asset unions, original-note publication, programmatic source edits, image-free print with ordinary links, scan waiting under another operation's byte claim, and hidden drawing surfaces.

Focused tests and the hidden native footer fixture are stated below. No full suite, package build, physical pen/camera interaction, installation, main push or release was performed by this reviewer. Root owns the frozen integrated/package workloads and full preflight.

## Reproduced findings and concrete closure

| Finding | Evidence | Fix and status |
|---|---|---|
| Footer reads the whole visual DOM twice per second while unchanged and synchronously clones/counts the complete document on input | Actual production script on the same 30,000-paragraph DOM: 20 idle polls took 159.173 ms and made 20 whole-text reads; input dispatch took 69.901 ms. Both sides count exactly 270,001 words. | Root `661d24e`/`a175548`: event/coalesced invalidation, bounded text-node slices, no clone/full text read, revision/tab/mode fences and programmatic edit/view hooks. Candidate idle dispatch was 0.011 ms with zero reads; input dispatch 0.154 ms. These are DOM/source stage timings, not whole-app keystroke measurements. |
| Same-length programmatic replacements could leave the footer's length-based signature unchanged | Actual footer fixture replaces text with the same character length and changes folds, note identity and source mode; stale visual/worker results are held across owner changes. | The same footer leaf observes mutations and receives explicit current-note edit/view invalidation; all cases publish only the current exact result. |
| Source footer parsing retained a complete Markdown token/HTML document graph | The original source counter delegates to full rendering. The 16 MiB inline diagnostic below confirms its substantial ownership. Moving it to a Worker alone would leave this allocation pattern intact. | Root `0712b9f`: shared compact semantic parser, one block/packed inline packet at a time, 8 KiB text slices, exact forward references/code/task/image semantics and no whole-document HTML. Browser UTF-8 admission is exact; Word's default byte check is unchanged. Scale latency and the final matched packaging gate remain explicitly active below. |
| Case-insensitive Find allocates two boxed-number offset arrays for ordinary text | Exact 1,000,006-unit ASCII source/query, same final match: 22.053→2.078 ms; observed post-call heap growth 37,835,040→1,828,716 B. The old maps require at least 16,000,096 B of numeric slots. | Root `f887884`: identity offsets for ordinary BMP/ASCII text; packed exceptions preserve expanding lowercase and astral code-point boundaries. No equal-document-length assumption is used. Existing Replace and visual boundary behavior remains exact. |
| Negative Unicode searches still prepared every exceptional offset despite no hit | Same 400,004-unit source, empty result: 212.702→4.711 ms; total lowercase calls 300,008→4 including the identical two-call warmup. | Root `afc3ac1`: check the lowered haystack before offset preparation. Operation itself now makes only the two complete-string lowercase calls. |
| Print image discovery reparsed an image-free document into a complete Main-thread token graph | Same 1,080,000-byte Markdown and exact empty image result: 132.868→0.140 ms; observed heap growth 44,598,312→1,084,352 B. An actual-source fault test forbids `md.parse` while references/aliases/thumbnails still resolve. | Root `78ce8b7`: reuse bounded shared semantic image discovery. The ordinary-link `mime(undefined)` crash was also reproduced on the initial source, but Root's independently authored shared alias fix `ce02466` had already closed it before this leaf; it is not counted as a second independent fix. |
| Scan byte admission wakes on its own failed provisional owner's retirement | Same 50 ms saturated byte pool, each worker-like RPC yielding once: 3,457 failed acquisitions before, one after; both cancel with AbortError and no retained listener. A direct bounded fault probe previously made 50 attempts in 0.517 ms. | Root `c950850`: use the shared typed capacity wake helper. Real byte release, owner-slot release, legacy untyped notification and prompt cancellation remain checked. |
| Hidden/zero-size drawing surface retains prior full ink/paper backing | This reviewer found the exact early-return seam and transferred the component scope to the UI owner. UI's actual source/native differential confirms 134,217,732 logical backing bytes before retirement and 12 B while zero-size. | Root `11574d2`, UI author `21bd624`: accepted contact is finalized before coordinates vanish; exact small and actual-worker dense ink/paper dimensions/SHA restore after show, and held old callbacks reject. This is logical backing retirement, not an isolated RSS or whole-pipeline speedup claim. |
| Packed Markdown view-cache eviction spends work allocating Map iterators and scanning deleted leading slots | A focused 1,040,000-byte CPU profile attributes material work to cache/typed-property dispatch, delimiter postprocessing and text joining. Six fresh-process exact 120,000-word samples: median 747.133→606.407 ms, about 18.8% lower; RSS stays about 170 MB. | Root cache-only leaf `1f82ba2`: fixed 256-slot FIFO ring, identical eviction order and lazy identity, no grammar/cap change. 10,000 cache-order comparisons and existing packed parser/ownership cases pass. No memory improvement is inferred. |

The initial footer hidden native gate at `56f5475` passed all six CSP/file-base/visual/source/programmatic/cancel-owner phases, zero console errors, four Worker termination requests and zero final active Worker handles. Sampled aggregate peak was 756,137,984 B under unchanged 1 GiB. Actual wrapper exit was zero; all four captured process PIDs were kernel ESRCH. That gate preceded the compact semantic bundle and therefore must repeat after the final integrated bundle. Browser `Worker.terminate()` is not described as an independent OS-process exit receipt.

## Source-footer scale evidence and active latency qualification

The first isolated diagnostic at `dee0e87` used the original exact 16,777,216-byte styled inline source, SHA `f50aa3d715f86ee06444e5a7a004e19b45f229f377c18994a6d6b7fe2853cf1f`, and returned exactly 1,935,831 words on both paths. Each controller includes its actual Worker thread in process RSS, plus a fixed 16 MiB observer reserve, under unchanged 1 GiB. Both wrappers exited zero, actual thread exits were joined and controller PIDs 83542/83595 were kernel ESRCH.

- Full-render diagnostic: sampled RSS plus reserve 888,455,168 B; 2,169.191 ms.
- Compact-counter diagnostic: 445,186,048 B; 29,426.435 ms; three block tokens and a 16,384-byte block ledger.

**These are diagnostic observations, not a strict before/after performance pair:** the first controller loaded renderer CJS for its baseline and a browser bundle in a VM for its candidate. Source/count and actual ownership/exits are exact, but different packaging can affect timing. `82a84b4` prepares identical VM/browser-bundle wrappers and actual parent/Worker V8 heap-limit receipts for the next granted run. Cache optimization `d79c1c0` was authored after this diagnostic. Do not subtract this isolated memory difference from a full-App image/OCR peak or claim the 29-second count is a latency success. The matched scale repeat and post-bundle native CSP repeat remain active work.

The subsequent **matched browser-bundle pair** at `47d7cb9` executes both paths inside the same VM wrapper and uses identical recorded runtime, source/bundle hashes, input SHA, 16 MiB reserve, 1 GiB guard and 120-second outer deadline. Both paths return all 1,935,831 words; wrappers exit zero, actual thread exits are joined, and controller PIDs 85031/85095 are kernel ESRCH. Actual parent and Worker heap limits are 4,395,630,592 B on both sides.

| Same 16 MiB inline stage | Full-render baseline | Compact semantic counter with fixed FIFO cache |
|---|---:|---:|
| Sampled process RSS plus fixed reserve | 872,169,472 B | 448,364,544 B |
| Count operation wall time | 2,703.630 ms | 26,653.121 ms |
| Exact result | 1,935,831 words | 1,935,831 words |

This proves a 423,804,928-byte sampled peak reduction in this isolated matched stage, with a substantial latency tradeoff (about 9.86 times the count wall time). It does not establish whole-App memory or typing gains. The candidate is near the newly introduced 30-second footer Worker timeout, so an actual hidden native 16 MiB count/CSP check is prepared with that product timeout unchanged; the fixture wait alone is 45 seconds. Latency qualification remains active until that run completes. No source content, input size, admission cap, heap limit or resource guard was lowered.

Two expanded native attempts are retained as **failed fixture diagnostics**, not counter or legal-source product defects. `cc77ac8` used an unstyled always-visible default textarea and crossed 1,135,427,584 B. `4aa33e3` corrected CSS, shell and mode visibility but still omitted production control attributes; it crossed 1,267,253,248 B. The second run preserved the exact 16 MiB source SHA and showed growth during `source-value-installed`, before any 16 MiB Worker-create/post receipt. Main/GPU/network stayed about 165.5/89.2/49.6 MB while the tab grew from about 305 to 963 MB. All ordinary six phases completed, with zero console errors; neither run reached a large counter reply or measured its timeout. Both wrappers exited one, and every captured PID is kernel ESRCH.

Test-only `231f461` now gives the rich/source controls their exact application attributes, including `spellcheck=false` on the source textarea, and adds a literal source-tag/style/shell parity assertion. That focused check passes. The faithful native repeat remains queued behind Root's candidate build/original100 Web gate. No counter, source-layout or whole-App memory closure is inferred from the mismatched fixtures, and the product timeout/input/guard remain unchanged.

## Focused verification

Checks were scoped to changed or causally implicated behavior, without a development full-suite run:

- Footer/Word semantic group: 18 checks, including 2,500 mixed-corpus and 500 deterministic malformed-source DOM oracle comparisons, long packed inlines, exact UTF-8, no full parse/render fault guards, stale ownership, and an actual isolated JS Worker importing the generated browser bundle and exiting after termination.
- Packed-cache/Word/footer affected group: 36 checks, including repeated cache eviction, Unicode, distinct attributes, nested scopes, cancellation and exact private backing retirement.
- Find: 16 checks, including 500 deterministic Unicode/surrogate sources, expanding/contextual lowercase, dense packed exceptions, Replace progression, IME keys and visual block boundaries.
- Print/Word: 22 checks, including exact files, references/aliases/thumbnails, cleanup failure/retry, admission and active consumer shutdown.
- Scan/admission: 29 checks, including the new self-wake faults, actual small PNG/JPEG Worker exits, exact source bytes and cancellation cleanup.

The integrated affected group on Root `1f82ba2` passes 102/102 serial pinned-runtime checks; the later explicit extension fallback contract and literal native-fixture parity assertion add one targeted check each. Counts overlap and must not be summed into a fictitious independent total. Actual large App/package/stroke/PDF/Word/import/export/soak evidence remains separate.

## Three costs per pipeline stage: honest ranking boundary

The user requires measured top-three bottlenecks at every complete stage using the same input, runtime, scope and limits. That requirement is **not yet established across the final integrated application**. Source complexity, three inspected costs, or timings from different workloads cannot substitute for measured ranks. This reviewer supplies the following three concrete attribution targets per stage for Root's final frozen workloads; the table is not a fabricated measured ranking.

| Complete stage | Three concrete costs/ownership boundaries to rank in the frozen run | Fresh closure or evidence boundary |
|---|---|---|
| Pen/contact | Lift fingerprint/commit; dense erase/selection preparation; pending gesture/save ownership | Reviewed immutable/delta paths. Historical native lift caller 295.1→0.6 ms and dense save improvements are in `PERFORMANCE-AUDIT.md`; current integrated ranking still needs the original stroke extremes. |
| Decode/editor load | Original encoded/decode/transfer overlap; bounds/fingerprint/normalization; current/history/cache construction and worker retirement | Read all ownership boundaries. No fresh whole-load gain is claimed; normalizer/worker/raw closure does not prove physical RSS. |
| Painting/editing | Actual page raster/repaint; per-input footer/Find/serialization; hidden/backdrop/canvas lifetime | Footer and Find have exact fresh source/DOM measurements; UI independently closes zero-stage backing. Frozen full App frame/timer costs remain required. |
| Asset transport/memory | Large IPC/source copies; private output/input retirement; admission waits and model/consumer overlap | Scan self-wake is fixed. Root's binary transport has a stage-time gain but no demonstrated output-bridge RSS gain; raw logical zero does not establish allocator retirement. |
| Save/history/recovery | Geometry delta/identity preparation; version/CAS/compaction/durability; captured/current/history asset unions and cleanup | Read the complete queue/resource/history seams. Historical sparse 2M erase/Undo save pairs are preserved; later integrated/package/current workloads require repetition. |
| PDF/scan/OCR import | Text-first/raster page work; decode/preprocessing/model startup; foreground/background arbitration and close | Scan admission is fixed. Root's original 100-image mixed gate still fails; safe native experiments remain test-only and cannot qualify production. |
| Export/preview/overview | Media/spool/print source discovery; Word semantic/XML/visible-fragment work; PDF/thumbnail/active consumer ownership | Print parse and packed cache have fresh focused evidence. Existing Word100/16MiB/table/TIFF receipts are earlier differently scoped checkpoints, not final integrated acceptance or a full 40MP Word App result. |

Root's latest memory attribution also disproves the suggested large live archive-JS/raw-owner explanation: the original full100 archive Worker has about 18.5 MB maximum used heap, 28.1 MB heap total, about 5.5 MB external and zero raw resident bytes. Those Root-reported facts do not identify the remaining Main native-allocation cause. No GC/cache pressure/heap-limit/source/pixel/cap reduction was used here.

## Evidence, integration and remaining gates

Committed drivers preserve the focused reproductions. Local ignored reports are copied under `test-results/performance-0.37/final-whole-app-performance/` on Root, including source/runtime facts, before/after stage JSON, native process receipts, the first scale diagnostic and six cache samples. Original inputs, counts, source/pixel/geometry contracts and admission limits remain unchanged.

The remaining assigned work is concrete: qualify the actual native semantic-counter timeout/latency and Worker/CSP seam; recheck the fully integrated source after all fresh reviewers' fixes; complete current per-stage top-three measurements; resolve the original full100 mixed memory failure; then Root performs coherent full preflight, frozen source/build/package fidelity, required native workload/recovery/cancellation/soak gates and truthful handoff. These are active qualification work, not findings silently moved to a backlog. No release readiness is asserted by this report.
