# Word reference native checkpoint

Source-only and hidden native work in `word-reference-full-native`; no installed app or user document was touched. All listed processes have actually exited. No GC, GPU/color policy, source resize, 1 GiB process guard, original fixture bytes, or fixed pixel authority was changed.

## Source dependencies

- `3f5b1fa`: bound visible text (16 KiB), structural nodes (4096), and complete table rows (512) per fragment; keep the 256 KiB wire maximum and all source/format limits.
- `5a43a9f` + `a0cce3c`: close from one verified durable journal, retaining marker/directory/inode checks and final proof; join pending admissions and preserve failed late rollback records. Thirty affected focused checks passed before the last catch closure; its thirteen affected ownership checks also passed.
- Root `e570d0a3`: start admitted image decoders eagerly; the viewport observer still controls admission.
- Root `70510fa`: cap only unloaded Word placeholder height at 4096 px, preserving complete loaded text/cells/pixels.
- Test-only driver, streaming fixture and isolated oracle files can be taken from this branch's current HEAD without cherry-picking duplicate product commits. The oracle helper originates at Perf `cd4d381`.

## Exact original native gates

Artifacts are under `test-results/performance-0.37/` in this worktree.

| Gate | Actual PID / exit | Source and runtime | Peak bytes | Evidence |
| --- | --- | --- | ---: | --- |
| 100-image product diagnostic | 44245 / 0 | `c5c063bf`, exact Root e570 runtime receipt | 751779840 | All 100 original 1800×2400 views and encoded SHA, typing, held decoder A/cancel B, actual worker exit/consumer ACK, recovery and final close. Pixel omission is explicitly diagnostic only. `word-reference-images-product-only-c5c063bf.json` |
| 100-image full pixel gate | 44554 / 0 | Same `c5c063bf` / e570 freeze | 1072431104 | 100 originals plus recovered image 0; 101 exact source/frozen CPU/default-display pixel proofs in 101 independently exited oracle renderer PIDs. Final close 41.7 ms. Only 1310720 bytes of headroom including the separate oracle. `word-reference-images-c5c063bf.json` |
| 477 MiB logical XML / 16 MiB inline | 45442 / 0 | `fe97b1c0` includes `3f5b1fa`, exact e570 runtime | 941670400 | 1893 actual virtual fragments; exact 16777201 plain bytes, every style/Unicode/space continuation, last ordinal 1892 reachable. SHA `bf2746a15ee2078fa9c57eaba6b17ccb41e71067705cfa07e77686d3ddc7c36e`. At most five loaded fragments. Original serial close took 12 s before the cleanup closure. `word-reference-inline-fe97b1c0.json` |
| Complete 2M-row table | 47353 / 0 | `d6aa102b` includes bounds, both cleanup leaves and Root placeholder cap; exact Root 80c9dee9 runtime receipt | 1034059776 | All 3907 original ordinals, 2000000 rows/text bytes, exact cells/styles/hash, final ordinal 3906, first→last revisit and actual other-reference tab-return. At most five loaded fragments, maximum physical scroll height 16018459 px. Actual worker/private-file close 1.454 s. SHA `be8889d3b8893c11d290b8dcf682164c326a90e6998f6bddb25d9a3a02daf666`. `word-reference-table-d6aa102b.json` |
| Max 40MP TIFF converter/native pixels | 48451 / 0 | `5a2225be`, converter SHA `891e62bc826f89ecf8790023733dea4e9879ed3e96e71ff291402778671c2109` | 852869120 | Bounded-file 160000166-byte uncompressed RGBA original; borrowed input SHA unchanged, actual converter worker exit joined, independent nativeImage 5000×8000 bitmap matches every orientation-6 pixel. Expected/native SHA `61067be2d69814b6d861e102713a06d1a5ec3067527ecb82829ab80e2933f5c4`. `tiff-owned-max-5a2225be.json` |

The table harness traversal deadline alone was normalized from 300 s to 600 s because the exact workload now traverses 3907 bounded fragments instead of 145 large fragments. Its original 20 s close, per-stage assertions and 1 GiB guard remained. Actual total was 381.22 s.

## Failures that drove closures

The original 256 KiB inline fragments had only eight tags but very long emoji text nodes; initial actual layout exceeded 1 GiB. The original table fragments contained 13792 rows / 27586 elements each, and four fragments mounted 110344 elements before the guard failed. The new layout bounds close both measured causes.

The first bounded table run reached Chromium's exact 33554432 px physical scroll ceiling at ordinal 2185, then admitted 69 fragments together. The Root unloaded-placeholder cap closes this observed failure; the complete repeat above passed every original row and return check.

The original 100-image close hung first behind queued release IPC, then behind a lazy native decoder that never started. Root's closed-client local release and admitted eager decoder closures passed the actual full 100-image close/fault repeat.

## Scope limits

These are affected Word reference/import/converter gates, not a whole-app/all-feature review or release approval. The full image Notepad open/autosave/index pipeline has separate current lazy-asset/debt/adapters/native work. The TIFF gate proves converter backing and native pixels; a full 40MP Word App baseline was not measured (conversion added about 619 MB above this isolated fixture baseline). Root owns final coherent integration, preflight, release and cleanup of verified stopped profiles.

The frozen original CPU authority remains `/Users/example/GIT/NoteMind-worktrees/image-native-attribution/test-results/performance-0.37/image-preview-surface-pixels.json`, SHA `1690a249b7b7c7340850c51b2d913a67b3fccba8d0a11dfbde889f40525229bb`; it was not regenerated. Each native report records its exact four compiled runtime SHA receipt and affected product source hashes.
