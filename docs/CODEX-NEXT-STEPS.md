# Codex: next steps for NoteMind

Written 2026-11-18 by Claude for Sean. Do these five tasks in order. Each one is small, has an exact finish line, and ends in one commit. Do not start anything that is not on this list.

## Where you work

1. Start from commit `39e76dc` on branch `perf/pipeline-top-three` (NoteMind 0.39.0, the build Sean is running).
2. Make ONE worktree and ONE branch, and use only those:
   `git -C /Users/example/GIT/NoteMind worktree add ../NoteMind-worktrees/codex-next -b codex/next perf/pipeline-top-three`
3. Commit each task on `codex/next`. Do not push, merge, tag, build an installer, or install anything.

## Hard rules

- **Do not edit files in `/Users/example/GIT/NoteMind` itself.** Claude has unfinished work in that folder.
- **Do not open, quit or replace `/Applications/NoteMind.app`,** and do not touch `~/Documents/NoteMind` or `~/Library/Application Support/NoteMind`. Tests use a throwaway profile (`NOTEMIND_DATA` set to a temp folder).
- **Files you must not change** (Claude is changing them): `src/renderer.js`, `src/notes-*.js`, `src/tablet/renderer/**`, `src/tablet-entry.tsx`, `src/tablet-bundle.*`, `src/input-monitoring.cjs`, `src/tablet/main/pen/**`, `test/tablet-two-bars.cjs`, `test/image-gap-app.cjs`. In `src/main.cjs` do not touch the three `inputMonitoring` lines.
- **Claude already owns these four items. Do not work on them:** the Input Monitoring prompt, deleting images in a notepad, pen buttons that need hold plus tap, and Bring in writing as ink floating over the page.
- One branch, no extra worktrees, no extra branches, no new audit or review documents.
- New files are written normally: one statement per line, at most 120 columns.
- Never change a limit, guard, fixture or assertion to make something pass.
- One hidden Electron run at a time: `node_modules/.bin/electron test/hidden-runner.cjs <name>`.
- Focused tests while working: `node --test --test-concurrency=1 test/<file>.test.cjs`. Run `npm test` once at the end of each task that changes `src/`.
- If a task cannot reach its "Done when" after two honest attempts, stop that task, write what happened, and go to the next one.

## How you report

Append to `docs/CODEX-RESULTS.md` on your branch, at most 10 lines per task, in plain words: what you changed, each "Done when" line with the command and its result, and what is not done. No other documents.

---

## Task 1 — The app does not quit

**What Sean sees:** after the NoteMind window is closed, NoteMind stays in the Dock and Quit does nothing.

**Evidence from today (0.37.0 and 0.38.0):** the window closed at 10:50:32 (pen log: `"e":"close","d":{"reason":"window closed"}`, recovery files written the same second). Ten minutes later the main process was still alive, used 0.3% CPU, its main thread sat idle in `-[NSApplication run]`, and it ignored two `tell application "/Applications/NoteMind.app" to quit` requests. It only ended on SIGTERM. With a window open, Quit closed the window and then hung the same way.

**Do this:**
1. Write a hidden test `test/quit-exits.cjs` that starts the app from `src/main.cjs` on a throwaway profile and checks three cases: (a) Quit with the workspace window open, (b) close the window, then Quit, (c) Quit with one unsaved drawing stroke on a sheet. In each case the process must exit by itself within 5 seconds and `note-recovery/session.json` must have been written before it exits.
2. Run it on the unchanged code and confirm it fails the way described.
3. Find the cause in the quit path (`src/main.cjs` handlers for `before-quit`, `will-quit`, `window-all-closed`; `src/close-flush-drain.js`; `src/close-flush-watchdog.cjs`; the shutdown waits added in 0.37.0) and fix it.
4. Do not fix it with a timer that force-exits. Every save that 0.37.0 waits for must still be waited for.

**Done when:** `node_modules/.bin/electron test/hidden-runner.cjs quit-exits` exits 0 with all three cases passing; `npm test` shows 0 failed.

---

## Task 2 — Five UI check scripts still click controls that moved

0.39.0 moved controls in the drawing pane. These five scripts fail because they look in the old places: `test/drawing-tools.cjs`, `test/pad-app.cjs`, `test/review.cjs`, `test/welcome-guide.cjs`, `test/workspace-ux.cjs`.

| Control | Old selector | Where it is now |
|---|---|---|
| Save Sheet | `button[data-tablet=pane-save]` | click `[data-bar=pane-menu]`, then `.float-menu [data-bar=pane-save]` |
| Save to Original | same button, `aria-label="Save to Original"` | `[data-bar=pane-menu]`, then `.float-menu [data-bar=pane-save-original]` |
| Clear the Sheet | `[data-tablet=clear]` | `[data-bar=pane-menu]`, then `.float-menu [data-bar=clear]` |
| Tablet orientation | `[data-tablet=orientation-menu]` | `[data-bar=pane-menu]`, row `[data-bar=pane-orientation]`, then `[data-bar=orientation-N]` |
| Paper | `[data-tablet=paper]` button on the bar | `[data-bar=pane-menu]`, row `[data-bar=pane-paper]` (the button is on the bar only when the pane is 688 px or wider) |
| Use Wacom screen | `#pen-control button[data-drawing-location=window]` | `[data-bar=video-menu]`, then `.float-menu [data-bar=video-wacom]` |
| Back from Wacom screen | `.pad-placeholder button[data-drawing-location=wacom]` | unchanged |
| Sheet action row | `[data-pane-slot="header"] [data-camera-head="tablet"]`, 36 px high | `#pen-control [data-camera-head="tablet"]`, no height of its own; the header slot is empty on a drawing sheet |
| Colour menu | `.pen-colour-menu` | gone; `.pen-swatches .pen-swatch` are always on the bar |
| Pen width | `.pen-width-select` | on the bar from 688 px; otherwise `[data-bar=pen-kinds]`, then `[data-pen-width="N"]` |

`test/tablet-two-bars.cjs` drives every new place; copy its steps. Read it, do not edit it.

**Do this:** update only selectors and click steps in the five scripts. Where a script asserts something that is no longer true by design (for example "the tablet header is a 36 pixel row", "the drawing location icon is directly available"), replace it with the matching true statement from the table and list each one in your report.

**Done when:** each of the five exits 0 under `node_modules/.bin/electron test/hidden-runner.cjs <name>`.

---

## Task 3 — What really happens at the two known limits

Two of your stress checks stop the app at a 1 GiB memory target: the 100-photo note with OCR, and opening the 16 MiB single-line note. Sean accepts both limits if the real app does not misbehave past that point. Nobody has looked.

**Do this:**
1. Add a test-only environment variable that raises the aggregate memory guard to 4 GiB. The default stays exactly as it is.
2. Run, hidden, one at a time, each to the end: (a) the 100-photo OCR workload, (b) cold open of the 16 MiB note, (c) the same OCR workload with 10 photos, (d) a 1 MiB note.
3. Write `docs/audit/LIMITS-IN-PRACTICE.md`: one table, under 30 lines. Columns: run, exit code, finished yes/no, peak memory, memory 60 seconds after finishing, wall time. For (a) add memory growth per page.
4. Under the table write one line per workload, chosen from: "finishes and gives the memory back", "grows N MiB per page and never gives it back", "crashes or hangs at X".

**Done when:** the four rows exist with real exit codes and the verdict lines are filled in. Do not fix anything in this task.

---

## Task 4 — One run: does native OCR pass on the current code?

Your native OCR experiment (branch `test/ocr-native-runtime`, `onnxruntime-node` 1.30.0 in a child process) last reached page 28 of 100 before passing 1 GiB. It has never been run together with the newer image transport that is now in the code.

**Do this:**
1. Bring the test files from `test/ocr-native-runtime` onto `codex/next` (test files only, nothing under `src/`).
2. Run the unchanged 100-photo workload once with the child-process native engine and the original guards.
3. Record in `docs/OCR-NATIVE-FEASIBILITY.md` under a dated heading: pages completed out of 100, peak memory, seconds per page for native and for the built-in engine, and whether the recognised text is the same on the quality corpus.

**Done when:** that dated result is written. **Then stop.** Do not make native OCR part of the app. Sean decides that from the number.

---

## Task 5 — A written plan for a real highlighter (no code)

0.39.0 has Marker, Fountain Pen and Highlighter without any change to stored strokes. The highlighter is an opaque pale band placed under the ink (`src/tablet/renderer/penKinds.ts`, `src/tablet/renderer/inkBeneath.ts`). Because of that it is switched off on sheets with a background picture and on PDF pages, and it hides the paper's dots. A real highlighter needs each stroke to carry its kind.

**Do this:** write `docs/STROKE-KIND-PLAN.md`, at most 60 lines, containing only:
1. Every file that writes, reads, validates, hashes or copies a stroke, as a table: file, function, what it would need.
2. The smallest stored form for the kind in each stored format (sheet store, drawing sidecar JSON version 1, PDF ink, camera ink), and which formats need a version number change.
3. How a sheet saved by 0.39.0 opens unchanged, and how a 0.39.0 app treats a sheet that has kinds.
4. The order to do it in, as steps of one commit each, with the test that proves each step.

**Done when:** the file exists and every stroke-handling file in `src/` appears in the table (check with `grep -rl "colorHex" src`). Write no code for it.

---

## When all five are done

Stop. Do not continue into other work. Sean or Claude will read `docs/CODEX-RESULTS.md` and merge `codex/next`.
