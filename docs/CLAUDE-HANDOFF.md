## Installation update — November 18, 2026

After the handoff, Sean explicitly requested installation. **0.37.0 is now installed at `/Applications/NoteMind.app`**, with its deep strict signature verified. No installed NoteMind process was running during replacement. The previous app and prelaunch profile are preserved at `/Users/example/Documents/NoteMind/Installation Backups/20261118T151902Z`. The app was not launched by the installer. Qualification boundaries below remain unchanged; earlier installation statements describe the 8 AM snapshot.

# NoteMind review handoff

**This is a tested WIP handoff, not a production-completion claim.** The installed 0.35.0 application was left untouched. Candidate source is 0.37.0. No new version was installed or released.

## Source and artifacts

- Integration branch: `perf/pipeline-top-three`, based on main `8ff1c0e`.
- Candidate: `/Users/example/GIT/NoteMind-worktrees/stable-candidate/dist/NoteMind/NoteMind.app`.
- Source-editor foundation: separate `feature/source-editor-adapter` branch; commit `600372b` is unwired Native-only service plus 13 boundary tests. It is not an enabled CM editor or an App/IME/history qualification.
- Full delivery scope and stage measurement boundaries: [delivery plan](DELIVERY-PLAN.md).
- Final independent reviews: `docs/audit/FINAL-WHOLE-APP-{BUGS,UI,PERFORMANCE}.md` and `FROZEN-FINAL-{BUG,UI}-RECHECK.md`.
- True signed-binary startup/save/recovery proof: [package checkpoint](audit/PACKAGED-STARTUP-RECOVERY.md).
- Large-editor architecture and immutable primitive evidence: [editor architecture](audit/LARGE-SOURCE-EDITOR-ARCHITECTURE.md). Archive `test-results/performance-0.37/source-editor-cm6-evidence.tgz`, SHA256 `fe7431a9f6a1148ba44336335bf5b23f276a688affdc8e17984efaa141bc3143`.

## Verified checkpoints

| Scope | Evidence |
|---|---|
| Coherent full regression | Source `43f4569`: **3,392 passed, zero failed, zero skipped**, actual exit 0 in 140.176 seconds. All 1,423 frozen file hashes and HEAD matched. This run includes the original 100-JPEG history case. Receipts: `preflight-final-d-source.json`, `preflight-final-d-post-proof.json`, and `preflight-final-d.log` under `test-results/performance-0.37/`. |
| Actual signed package | Candidate `230303d`: two real executable launches passed startup, exact 20-character durable save, joined quit, cold recovery of the same id/text, and joined quit. True packaged mode and real `MacOS/NoteMind` path were checked. All eight app PIDs exited; 7,461 frozen entries matched. |
| Extreme drawing | Original two-million distinct dots passed all five fixed pixel oracles, peak 1,008,320,512 bytes. Original 100,000 pressure strokes × 20 points passed all five, peak 887,095,296 bytes. These are the recorded source checkpoints, not claims that every subsequent package was rerun. |
| PDF reference | Fresh 100-page native UI run passed 22 phases: fit, ink Undo/Redo, navigation, cancellation, source pinning, search, export and four rotations; peak 992,477,184 bytes. |
| Image input transport | Matched eight original JPEGs, no canvas/OCR: DATA versus script-literal input preserved every SHA. Renderer RSS 158,629,888→132,579,328 bytes; aggregate 460,652,544→416,808,960 bytes; input source characters 15,855,836→0; stage wall 173.341→43.001 ms. All captured processes exited. This is a bridge-stage gain, not whole-App qualification. |
| Large editor primitive | Exact original 16 MiB source/hash, full model, backward model selection, far scroll and disposal passed in an isolated CM prototype at 497,270,784 bytes. A disclosed native-overflow calibration corrected an outer-box versus usable-width oracle. One checked library gap-axis change is required. No production App integration or trusted IME/history proof follows. |

## Open qualification boundaries

The latest complete mixed Web run before DATA input still failed at 1,080,541,184 bytes during the first OCR request after 104 display phases. The safe experimental FILE+COLD Native run completed 28 readings, then failed the unchanged aggregate target at 1,109,786,624 bytes. All its 33 captured PIDs exited and all 7,277 frozen identities matched. Native remains experimental and is not a product dependency/backend. A complete original-100 run after the DATA transport has not yet passed.

The production active source editor still uses the native textarea and retains the original cold 16 MiB layout failure. The isolated viewport primitive demonstrates a bounded path; the complete consumer migration, trusted input/composition, sole App history authority, Find/reveal and 50 MiB policy still require implementation and actual App tests. Do not enable the unwired foundation or call it complete.

Complete integrated top-three bottleneck rankings at every requested pipeline stage are not demonstrated. Existing source/storage/parser/Find/bridge measurements retain their narrower scopes. Physical Wacom behavior was not exercised by the hidden synthetic/component tests.

## Review and operational boundaries

One heavy build/native run at a time, low priority, hidden nonfocusable windows and disposable profiles. The original 1 GiB aggregate, 900 MiB renderer, 384 MiB raw and 2 GiB free-disk guards were retained. No forced GC, cache flush, reduced model/image/geometry/text input or heap/thread reduction was used to manufacture a pass. Do not kill the user's installed app or use real pen/media/clipboard in tests.

Final signed build `54343` actually exited 0 at candidate `26d1f617963744dd3be0c00494d0794b6fe70284`. All **659 production files** match the tested Root source, candidate and package; `codesign --verify --deep --strict` exited 0. Evidence: `build-final-d.log` and `final-d-source-package-fidelity.json`. The new DATA package has not repeated the full 100-page OCR gate or the earlier two-launch startup checkpoint. No main/tag/release/install occurred; this remains a WIP handoff.

Source-level port fault tests cover acknowledged private ownership, every accepted retry clone, late/duplicate data, frame/key/identity mismatch, borrowed typed views, actual-exit settlement, ACK publication failure and capability fallback. The final full-suite result and package fidelity must accompany the final source head; earlier passes do not qualify later changes.
