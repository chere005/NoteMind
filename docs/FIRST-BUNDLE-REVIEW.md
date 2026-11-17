# First stable bundle review

This records the first independent bugs/data, UI/UX and performance/architecture panel. It does not count as the later all-feature panel or final three whole-app audits.

## Bugs and data integrity — passed

Independent reviewer: `review_first_bundle_data`. Final source: `23fa66b93e96edd9b61b1721a691c90a6232523b`.

| Finding | Integrated closure | Regression evidence |
|---|---|---|
| A resolved PDF worker termination request authorized replacement and lease cleanup before actual exit. | `136d89c`: actual exit and owned cleanup gate replacement; disposal joins the same barrier. | Resolved/rejected-but-alive workers, delayed cleanup, actual exit, retained generation authority. |
| A pending selection edit or unfinished lasso crossing page owners left controls busy or a stale outline on the new page. | `289ef1e`: reset UI state from the new controller; preserve old edit completion and notifications on its original owner. | A→B while editing; B starts its own edit before A completes; old lasso clears. |
| Late cancellation during lazy seed membership merge published partial ownership and retained a closed page's ink/background. | `23fa66b`: privately stage union/background ownership; publish atomically; retry when concurrent membership changes. | Abort and owner close at every yielding stage, exact retry, concurrent save/new pen ink/other seed, independent same-set mutation probe. |

The final source reread includes drawing/pen/page save, close and quit ownership; preset stores and mirror routing; selection/precision hooks; PDF models, recovery and export; live/saved overview thumbnails; bounded Word parsing/publication; owned metadata, chunk ACKs and lazy seeding; compact locators, selection flags and history accounting.

Evidence: 171 focused feature/ownership cases on `42754e3`; 76 Word/owned-pipeline/ACK/retirement cases on `f6cb0ab`; final 78 targeted history/order/raster/selection-lifetime/PDF-jobs/ACK/seed cases on `23fa66b`. Independent Word checks cover 2,000 full-parser differential cases, 2,500 link-candidate differentials, six dense semantic corpora and injected XML failures preserving the old target without publishing a new one or retaining spools.

No unresolved blocker was found in this review's scope. This is source and focused Node evidence; the reviewer did not run native Electron, a build, the installed application or user documents.

## UI/UX — active

Fresh independent reviewer `review_first_bundle_ui` is reviewing `5287a7a`, whose product source matches the data-reviewed snapshot. Native jobs require the shared serial slot. Confirmed findings receive isolated fixes and affected interaction checks before disposition.

## Performance and architecture — next dependency

Fresh independent reviewer `review_first_bundle_performance` is active. The repeated producer run and real save/reopen gate exposed thin GPU/native memory headroom, so this panel owns an isolated dense-canvas backend A/B with unchanged pixel oracles and resource limits. Architecture owns the real IPC pipeline repeat of any accepted renderer fix. Existing author/reciprocal reads do not substitute for this role.

## Integrated native evidence

These tests exercised production components/services with hidden windows, disposable profiles and physical pen/media access disabled. No installed application was changed.

| Source | Scenario | Result |
|---|---|---|
| `7250f08` | Actual App/PadHost: camera reorder, 3,000-page overview with 30 mounted cards, portal/source/save ownership, active-PDF pen commands, close during open | Eight phases pass; zero runtime errors/physical media calls; sampled combined peak 823,132,160 B. |
| `7250f08` | Scoped >2 MiB SVG verified-file conversion and actual thumbnail worker | Exact tested colors, cancellation and zero pending/temp ownership; sampled peak 558,989,312 B. |
| `7250f08` | Actual 100-page PDF reference/raw markup/navigation/search/cancel/text-first import/export/scan workflow | Thirteen phases pass, exported ink aligned at all four rotations; zero runtime errors; sampled peak 951,812,096 B. |
| Isolated `e17e3cf` | Actual producer 2M one-point strokes: first paint, erase, discarded ACK, dirty/full repaint, both Undo/Redo sequences, selection, disposal | All 17 functional phases and five fixed SHA oracles pass below unchanged1GiB cap, sampled peak1,070,694,400 B. Process then exited1 from temporary-profile cleanup; cleanup-only fix8300136 is integrated as5287a7a and clean-exit confirmation is queued. |

The real Main/preload/staged-save lazy2M pipeline remains a separate active gate. A producer pass is not a completed save/reopen or packaged-app claim.

## Repeated scale gate and current closure

The cleanup-corrected producer run on `8300136` again preserved all five fixed hashes and both Undo/Redo sequences, but selection preview crossed1GiB at1,074,954,240 B. The earlier functional pass is not a stable repeated pass. Real IPC source `d41eab8` passes reopen/first paint/metadata save but fails erase-paint at1,085,014,016 B. The final observed jump is GPU101.42→128.63 MB; Main284.18 MB and Tab622.89 MB are unchanged. No repeated-pass, complete save/reopen, packaged or release claim is made.

The UI panel has already fixed PDF page-number Enter before source load (`4078d36`,15 focused component/view/session checks). Its overview keyboard-focus finding is being fixed in isolation. The first performance panel owns the native renderer experiment; Word/CAS foreground scheduling is independently being implemented through a bounded file-only worker after verified media spooling.
