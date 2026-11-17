# Performance investigation and release evidence

This is an active engineering record, not a completed release audit. Installed NoteMind remains 0.35.0. The 0.36.0 package is the comparison baseline. Development measurements below must be repeated on a frozen, signed candidate after the remaining fixes and review panels.

All workloads run sequentially at reduced priority, in temporary profiles with hidden windows. No user documents or installed application are modified. RSS includes worker threads in the same process; renderer working-set measurements are separate. A stopped baseline is not a completed workload or a valid final-memory comparison.

| Pipeline stage and workload | Baseline | Development observation | Interpretation / active owner |
|---|---|---|---|
| Dirty-state signature, append to 100,000 strokes / 2,000,000 points | 16.83 ms | 0.100 ms; Undo 0.011 ms | Exact legacy signature retained, incremental immutable leaves. Drawing team. |
| Full pressure repaint, 2,000,000 points | 666.3 ms / 1.9 million stroke calls on the input thread | Tile rebuild about 1.01 s total; 9.3–10.5 ms max timer gap / about 18.5 ms frame gap; erase repaints 1 of 48 tiles | Active-page worker tiles integrated. Whole-selection transforms and pending mutation ownership are still being completed. Drawing team. |
| Dense editable payload, same 2M points | Compact JSON 70.09 MB | Exact binary 49.60 MB; chunked packing 399 ms wall / 7.5 ms maximum heartbeat gap | Geometry, pressure, colors and signed zero preserved. Drawing team. |
| Dense internal checkpoint, 2M points | 94.49 MB full JSON rewrite / about 105 ms for a 20-point append | Chunk store initial binary checkpoint 394 ms / 14 ms timer gap; warm appends 17.54–17.89 ms / 6–7 ms gap, about 12 KiB written | Isolated store profile; >99.98% fewer append bytes and about 83% less wall time. Crash/compaction review fixes remain active before integration. Storage team. |
| Selected dense page load and metadata-only startup | Full graph hydration | Compact selected load 122 ms / 6.5 ms timer gap; metadata list 1.7 ms, restart catalog 27.7 ms | Isolated chunk store; lazy UI and bounded inactive models are under review. |
| 100 distinct 1800×2400 JPEGs, 148,809,294 asset bytes | All 148.8 MB materialized before first viewport; renderer 784 MB after open, >995 MB before safe abort | First viewport 1.48 MB; renderer 421 MB after open, peak 496 MB; complete run | Lazy Blob/decode caches and immutable token IPC. Architecture team. |
| Same JPEG fixture, repeated draft + autosave transport | Legacy logical transfer would be about 794 MB | Zero repeated base64 bytes in either direction | Initial open still transfers original source once. |
| Same JPEG fixture, initial open and save memory | First image 1,017 ms; main peak 1.06 GB before aborted autosave | Latest complete worker-CAS run: first image 901 ms, autosave 2.592 s, main peak 1.276 GB, renderer peak 550 MB; open max gap 76 ms | Ownership fixes reduce the intermediate 2.11 GB peak, but the aborted baseline is not a completed memory comparison. Remaining phase/GC attribution and frozen paired runs are required. Storage/root. |
| 64 MiB deterministic binary assets, complete draft + autosave | Warm 5,385–5,398 ms; max main heartbeat gap 1,239–1,245 ms | Worker-CAS warm about 476 ms; gap 6.1–6.5 ms; peak about 868 MB | Complete owned-buffer/cache workload, one worker epoch with zero rollovers. Repeat on frozen signed candidate. |
| Four history versions, same 64 MiB assets | About 268.6 MB of archive copies | 67,137,730 bytes shared objects + all manifests | Public files and recovery remain self-contained; older versions stay readable. |
| 5.34 MB / 1,000-record library index | Synchronous stringify 11.8–23.4 ms main gap | Worker enqueue 3.5–5 ms / 3.7–5.3 ms main gap | JSON parse/stringify moved off main; no-op commits avoid rewrite. |
| Three real OCR fixtures, exact output hashes | 3,005.9 ms wall, 7,484 ms CPU, 3 worker starts | 2,069.7 ms wall, 4,569 ms CPU, 1 worker start | 31% wall / 39% CPU reduction; peak RSS unchanged (~479 MB); worker exits after idle period. |
| 100-page PDF-options preview | Full document image embedding | 32,031-byte layout; 3 first-page thumbnails; Blob leases released | Hidden desktop check passed. Actual full output retained all 100 images. |
| CAS binary sidecar above ordinary 50 MiB limit | Unsupported ordinary-entry limit | 54,526,059 bytes roundtripped exactly; next version adds zero objects; ordinary oversized binary rejected | 643.6 ms wall / 12.2 ms max heartbeat gap. Root verification complete. |
| Drawing Undo ownership, 100,000 strokes / 2M points | Count-only history retains up to 100 full transformations without a byte budget | Global 128 MiB Undo-only budget with nearest complete Undo/Redo protected; first append 0.32 ms, append Undo 0.12 ms; large transform ownership 125.6 ms total / 5.6 ms timer gap; full Undo/Redo gaps 3.3–4.2 ms | Shared immutable resource DAG and yielding atomic transitions integrated; initial/lifecycle call sites still being adopted. Current ink is never evicted by the history budget. |
| Zstd in actual Electron Node 24.22.2, 94.49 MB legacy geometry JSON | Deflate level 1: 8.45 MB, 121.2 ms encode / 61.8 ms decode | Zstd level 1: 2.96 MB, 72.3 ms encode / 53.5 ms decode; exact roundtrip and corruption rejection | Codec result only. A 512 KiB noisy extent's complete fsynced roundtrip worsened from 4.03 ms raw to 6.98 ms zstd. Keep raw on latency-sensitive internal writes; public ZIP format unchanged. |

Local evidence is under ignored `test-results/performance/` and `test-results/performance-0.37/`. The real-JPEG baseline archive SHA-256 is `b0d75fb0571e629d6d2bd43c32fadb5e116bf317f1c741b2e58ba462fc704fcd`. The baseline source/package is frozen in `test-results/performance-0.37/notemind-0.36-baseline`.

## Gates and dependencies

1. Finish correctness fixes and measured memory/paint/load bottlenecks; repeat complete paired stress workloads and recovery tests.
2. Run independent bugs, UI/UX and performance reviews; implement and retest every actionable finding before the stability increment.
3. Integrate isolated approved features one at a time: selection editing, presets, precision navigation, page overview, cancellable imports, and right-pane PDF reference with editable Wacom markup. Pure feature modules can proceed while foundation dependencies are fixed.
4. Run another three-way feature review, fix findings, then three fresh independent whole-app audits and fixes.
5. Freeze source; run the full suite, hidden packaged checks, stress/recovery/soak and strict signature verification. Notify before any NoteMind installation. Prepare the requested Claude handoff in chat with final commit, scope and reproducible measurements.

Bounds are explicit rather than unlimited: normal archive entries 50 MiB, validated binary graphics up to 150 MiB, total uncompressed archive 199 MiB, drawing 2 million points per sheet. Tests within those bounds must preserve responsiveness and data; hardware delivery cannot be established by synthetic input alone.

Additional confirmed foundation work: camera pages eagerly decode every saved image, repeatedly encode immutable canvases and rewrite a large JSON graph on the main process. Root owns the camera UI/cache path; reuse of the chunked persistence engine follows its durability freeze. This is an active fix, not an accepted limitation.
