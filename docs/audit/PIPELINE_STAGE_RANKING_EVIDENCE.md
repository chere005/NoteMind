# Pipeline stage ranking: evidence and runnable probes

Prepared against Root `9055d845` and the explicitly named historical reports on November18. The current native mixed checkpoint is `8fa9d856`; this report does not replace later Root evidence. No installed app, personal data, device, input, clipboard or screen was used. Only NoteMind paths were inspected. No product source changed.

**The requirement to identify and address the top three measured bottlenecks at every complete integrated stage remains open.** Existing reports establish real improvements and some failed gates, but do not establish that full set of rankings. Code complexity, outer request latency and an unobserved failed tail are not substitutes for measurement.

## Factual coverage

The read-only extractor preserves artifact SHA256, available source/runtime provenance, observed values and missing coverage in Root's ignored `test-results/performance-0.37/pipeline-stage-existing-evidence.json`. Its14file allowlist is fixed in `scripts/summarize-pipeline-evidence.cjs`; it does not inventory other projects.

| Pipeline stage | Actual evidence available | Ranking boundary and next measured seam |
|---|---|---|
| Pen/contact handling | Root's recorded lift/finalization measurements and native interaction evidence; the producer pressure report records real erase/Undo/Redo commits and painting. | There is no current integrated, complete three-cost contact profile. Correlate contact receipt, final fingerprint, model commit, save enqueue and first paint in the same owning renderer. Native hardware/input policy remains unchanged. |
| Decode/editor load | Historical100k×20probe: compact worker load1846.487ms, renderer hydration542.077ms, ID seeding32.935ms. Pressure producer: hydration1897.1ms, model install50.1ms, raw pull43.2ms. | These are observed historical operations, not the final source's internal top three. The sheet probe below measures current real storage initialize/geometry/index/file steps; actual renderer hydration/model/history/paint still needs the existing native App driver. |
| Painting/editing | Historical pressure producer initial paint871.5ms total/656.9ms paint; sparse erase12.8ms total/11.7ms paint; dirty union33.3ms/32.5ms paint; selected update20ms. Exact producer packets/pixels were independently checked by the original driver. | Different operations are not competing bottlenecks inside one stage. Repeat renderer packet preparation, paint and ACK intervals at the frozen source. The earlier dense browser report exceeds the physical budget and includes forced-GC diagnostics; it is not accepted final evidence. |
| Asset transport/memory | Eight identical-source inputs: private decoder median73.166→21.371ms, sampled combined peak567132160→447741952B; all input SHA and the separate14RGBA cases pass. Binary output improves bridge wall about70.8%, with no demonstrated RSS gain. | These are narrow, causally scoped pairs. They do not rank decode, transfer, display and indexing together. Current Main/source/verified-file/transport/converter/reader spans are provided by the observer below. Renderer internal decode/display remains unobserved by CJS hooks. |
| Save/history | Actual unique2MApp erase15539.9→4397.3ms; Undo15647.4→4421.1ms. Separate numeric-leaf pair: rename4605.4→1475.2ms; aspect5044.1→2187.8ms. | Original whole-operation pairs are meaningful, each with exact public bytes/identity/reopen proofs; they are not self-time rankings. Historical save wrappers overlap and have no start/end coordinates. The new worker JSON/file/publish and Main queue spans separate observed compute/IO/queue residuals. |
| PDF/scan/OCR import | Existing actual100-page/native correctness/memory reports; exact OCR preprocessing431.693→326.713ms with54unchangedFloat32hashes and derived temporary allocation46694400→23347212B. Historical OCR reuse has the same three fixture text hashes. | Current model startup/inference/crop/postprocess are not all measured. The full100mixed Web run fails at first inference before any reply. CJS controller/reader/source/export spans cannot rank the unobserved ESM model tail. Root/native owner retains that failing gate. |
| Export/preview | Word100,16MiBinline and2Mtable exact/native proofs; table close1454.070ms. The2Mtable `word-preview-open` IPC has36619.822ms largest inclusive latency. The40MPTIFF converter passes original bytes/pixels independently. | Word driver UI phases include explicit waits and pixel-oracle work. Current parser/HTML fragment/file/ZIP/conversion/publication/cleanup spans are observable below. Real browser text shaping/layout and full40MPWordApp need their native driver; converter-only evidence does not qualify them. |
| Idle/typing/Find | The independent final whole-app performance owner has the fixed footer, Word inline, Find, scan-capacity and print stage pairs. | Those files and findings remain with that owner. This report adds no duplicate fix or inferred final ranking. |

Historical files: `test-results/performance/drawing-stages-100000.json`, `sheet-delta-profile-100000.json`, `drawing-native-final/ink-native-pressure-producer.json`, `sparse-save-pair-c033df2-f7a18a6/{comparison,metadata-comparison}.json`, `image-index-7527e5f-comparison.json`, `ocr-preprocessing-b58b5ab.json`, and the named Word reports under `test-results/performance-0.37/`. Several older reports omit an exact source receipt; that absence is preserved rather than repaired by guessing.

## The current failed integrated image run

`test-results/performance-0.37/real-raster-audit-web-full-mixed-8fa9d856.json` records104completed display/typing/autosave/tab-return phases, all100original1800×2400JPEGs, zero runtime errors and **zero OCR replies**. It fails the unchanged1GiBcombined guard at1092501504B during first inference. At that sample Main is631455744B, renderer302219264B, GPU114802688B and network44023808B. These components sum to the observed sample; they are not independently sampled maxima.

The largest observed whole phases are autosave6003.285ms, open2889.474ms and typing663.009ms. They include frame waits and driver observations. Archive request-to-reply sums are `parseJson`3336.319ms/27calls, `encodeFile`1830.305ms/5 and `inspectFile`1085.941ms/1. They **are not three self costs**: `NotesStore.readIndexState` requests JSON work through the same serialized ArchiveCodec queue, so its wait can include a different operation. The new `archive-worker:parseJson`/`builtin:JSON.parse` trace distinguishes actual parsing from that outer wait. Do not sum nested or concurrent intervals.

## Ready probes

`test/helpers/pipeline-stage-metrics.cjs` is test-only. It instruments exact allowlisted CJS export/prototype seams after resolving the explicit source directory and hashes each loaded source. The CLI can wrap an existing driver before its imports and prepend the same observer to its owned CJS Workers. Original Worker data/options/resource limits, source files, workloads and production guards remain in effect. ESM workers are skipped and counted. No dependency/backend/OS change is made.

For an existing serialized native run, use its current environment and pinned executable, replacing only its entry with the observer CLI. For example:

```sh
nice -n 15 /Users/example/GIT/NoteMind-worktrees/stable-candidate/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /Users/example/GIT/NoteMind-worktrees/pipeline-stage-ranking/scripts/summarize-pipeline-evidence.cjs --repo /Users/example/GIT/NoteMind --trace-driver test/real-raster-index-completion.cjs --source-root /Users/example/GIT/NoteMind-worktrees/stable-candidate/src --out /Users/example/GIT/NoteMind/test-results/performance-0.37/stage-index-8fa9d856
```

`--source-root` selects observer matching, not the app runtime. Retain the original driver's explicit runtime-selection environment and source/package verification. An empty source receipt or missing target is a missing observation, never a pass. Additional driver arguments follow `--` (for example `-- images` for the existing Word driver). Do not run this concurrently with another heavy/native/build lane.

The focused source-only storage probe is also runnable without changing a driver:

```sh
ELECTRON_RUN_AS_NODE=1 nice -n 15 /Users/example/GIT/NoteMind-worktrees/stable-candidate/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /Users/example/GIT/NoteMind-worktrees/pipeline-stage-ranking/scripts/summarize-pipeline-evidence.cjs --repo /Users/example/GIT/NoteMind --probe-sheet 2000000 --source-root /Users/example/GIT/NoteMind-worktrees/stable-candidate/src --out /Users/example/GIT/NoteMind/test-results/performance-0.37/stage-sheet-2m-8fa9d856
```

This runs the **exact existing** `test/helpers/sheet-native-fixture.cjs` in an owned child with the original224MiBheap flag; the helper's source SHA and actual child exit are recorded. It contains repeated one-point#123456strokes at(.5,.5) with distinct occurrence identities, not the unique-grid workload. Fixture generation/save is measured separately as setup. The observer then runs actual `SheetPersistence` catalog, page load, metadata save and close, proves exact geometry-body and identity SHA, and observes actual Worker exit. This is storage-stage evidence; it does not substitute for unique-gridApp hydration, pen, canvas, erase/Undo save/reopen or original mixed acceptance. The1GiBwhole-owned-PID-group sampled RSS guard includes parent+fixturechildduring setup and parent+same-processWorkersduring measurement; the2GiBfree-space floor remains. No forcedGC is used. The input count is explicit and bounded by the published2Mlimit.

Main/worker traces can be reduced alongside the exact existing evidence:

```sh
node /Users/example/GIT/NoteMind-worktrees/pipeline-stage-ranking/scripts/summarize-pipeline-evidence.cjs --repo /Users/example/GIT/NoteMind --trace-dir /Users/example/GIT/NoteMind/test-results/performance-0.37/stage-sheet-2m-8fa9d856 --out /Users/example/GIT/NoteMind/test-results/performance-0.37/pipeline-stage-trace-evidence.json
```

## Measurement semantics and admission to a ranking

- Each trace has one PID/thread/monotonic-clock scope. Exclusive **observed wall** subtracts the union of direct child intervals, clipped to the parent's lifetime. It does not sum overlapping child waits or pretend uninstrumented descendants are absent. Sibling totals may overlap. No clock correlation or cross-process total is inferred.
- Process CPU deltas include other worker threads/concurrent spans; they are not self CPU and must not be added across nested spans or worker reports. True per-function CPU attribution still requires a separately scoped V8/native profile.
- Held-file `bytesRead`/`bytesWritten` counters are actual returned bytes. They cover observed `FileHandle` operations, not all disk traffic, durable physical IO, IPC cloning or allocator ownership. No syscall count is converted into bytes.
- Existing acceptance drivers retain their timer/frame-gap and owned-process samplers. The source-only probe's heartbeat uses25ms cadence and is not an Electron typing/frame measurement. All peaks are sampled; source-only RSS includes NodeWorkers in that process, while the actual native driver counts its original owned processes.
- Observer overhead is real: promise wrappers, AsyncLocalStorage, clocks/process CPU calls and a bounded20000event buffer. Main snapshots checkpoint every1s; worker root completions also checkpoint before a parent can terminate the consumer. Flush wall time before the current snapshot is reported; it excludes the current flush and per-call overhead. Observed runs are diagnostics; final acceptance remains an uninstrumented same-source repeat.
- A terminated Worker may have a last operation checkpoint without a final JS-exit flush. `finalProcessExitFlush:false` is preserved; actual captured exit is a separate driver receipt. An unfinished/dropped event, missing source seam, unknown tail, observer error or failed product guard precludes a complete ranking.
- `ranking` defaults to `null`. It is emitted only for an explicit `coverage.status:'complete'`, nonempty manual proof, at least three distinct expected candidates, presence of every candidate, and no unfinished/dropped events. The caller's proof must separately establish candidate/scope completeness; the helper cannot discover that proof. An observed-largest list remains labelled observed-largest.

Focused verification: six helper checks pass, including overlapping async child intervals, explicit unknown coverage, bounded traces/rejections, exact-source hook restoration and an isolated real Worker with preserved workerData, JSON parsing, exact five-byte file-read accounting and actual exit. The100stroke exact-existing-fixture source smoke passes with original byte hashes and actual captured fixture-child/worker exits; its Node26timings are smoke evidence only. No native/heavy lane, full suite or final acceptance was run by this owner while preparing this report.
