# Signed package startup and recovery checkpoint

The actual signed macOS NoteMind 0.37.0 package passed two consecutive hidden launches on November 18, 2026, finishing at 07:41:56 Central. This qualifies startup, a small durable draft, cold recovery, and joined shutdown at the exact package below. It is not a performance, tablet, large-document, or whole-app readiness claim.

## Exact artifact and isolation

- Candidate checkout: `230303dc5a94a9b034370ad9b69f7f316498351f`; Root at capture: `280f69010d7d3f1f0d2537ace824bd852ffd0f82`.
- Actual binary: `/Users/example/GIT/NoteMind-worktrees/stable-candidate/dist/NoteMind/NoteMind.app/Contents/MacOS/NoteMind`.
- Actual app path: the same bundle's `Contents/Resources/app`. Runtime: Electron 44.11.3, Node 24.22.2. Actual `app.isPackaged === true`, version `0.37.0`, and executable/app paths were asserted before Main resumed. No packaged-state environment override was supplied.
- Inspector stopped at the exact package `src/main.cjs` line 0. Isolation was acknowledged before any Main require: unique owned profile/home/workspaces/documents/logs, pen disabled, hidden nonfocusable windows, suppressed focus/global shortcuts. No installed app, user profile, physical input, clipboard, media, or user documents were used.
- Fixture-only hidden scheduling disabled background throttling. The test supplied Worker `execArgv` with only Inspector flags removed and preserved other options/resource limits. Renderer work used a nonblocking Main/Inspector bridge. These are controller policies, not product changes.
- A full 7,461-entry bundle/controller/helper inventory, including signed resources and runtime binaries, was identical before and after both launches. The one reusable hash scratch buffer was retired before launching the application.

## Actual result

The first launch reached DOM ready and the Notes ready receipt, created a new note, inserted the exact 20-character string `0123456789abcdefghij`, completed `flushTarget(..., {requireDurable:true})` and the subsequent flush, and verified the same note id/text. `app.quit()` reached the final quit sentinel and the process exited 0. The second cold launch recovered the exact same id and text from the same isolated profile, then joined quit and exited 0.

The sampled controller-plus-owned-process peak was 621,150,208 bytes for create/flush and 525,385,728 bytes for cold recovery, below the unchanged 1 GiB guard. These are startup fixture measurements, not a product-wide memory qualification or a performance improvement comparison.

Controller PID 20319 and application PIDs 20329, 20334, 20335, 20337, 20353, 20358, 20359, and 20360 were all independently checked for kernel `ESRCH` after completion. No successful-run process was killed. Worker online records were captured; their final individual exit events were not sampled after quit, so the exit proof is the actual completed process shutdown, not an invented per-worker receipt.

## Retained evidence and failure boundaries

Owned ignored evidence is under `/Users/example/GIT/NoteMind-worktrees/frozen-final-bug-recheck/test-results/packaged-hidden-startup-prep/`:

- Successful actual session `49676`: `owned-Y2Vakx/report.json`, SHA-256 `087a5d082dcb2ae64ae34e81ab1714b62e5d84d739fc34d7af4a957657d03c64`.
- Frozen controller SHA-256: `78f5180018bedb8f08cc549cc87c0c3965a824efe77710a3e5fc6e02dd98791a`.
- Signed `CodeResources` SHA-256: `60bdfbbc6396757ba3fb6aab1cc29e7af6350a87a61839c279a8150bf67f6a26`.
- Earlier failures remain in `owned-Pb9n7P`, `owned-35aICL`, `owned-Mc5hEf`, and `owned-jUPJ0q`. The first strict pre-Main failure exposed the real executable-branding defect; the remaining failures were instrumented controller readiness/flush stalls. Their exact failed controller copies and unchanged-bundle evidence were preserved. No product flush workaround was introduced.

The successful Worker scalar records show original and effective `execArgv` both empty. Explicitly supplying the normalized option coincided with resolving the controller's previous flush stall, but does not by itself establish the exact original Inspector-inheritance mechanism. The tiny owned Worker proof independently established readiness and exit after filtering known Inspector options; it is not a causal trace of the earlier stall.

Any subsequent source, generated artifact, dependency, or package rebuild requires a new source/package fidelity check and a repeat of the relevant package smoke. No changed later package is covered by this checkpoint.
