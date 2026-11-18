# NoteMind: tasks to finish and ship

Written 2026-11-18 from Sean's five decisions. Base branch: `perf/pipeline-top-three`. Installed build: 0.39.0 (0.37.0 plus the two-bar drawing pane with colour swatches, pen kinds, Writing as a strip, and the cursor between images). Target release: **0.40.0**.

Order: **A** limits are harmless → **B** source editor → **C** native OCR → **D** verify → **E** ship → **F** clean up.
Builder: Sonnet (`claude-sonnet-5-5`). Reviewer: Opus (`claude-opus-5-5`). Merging: the coordinating session, one branch at a time.

## Before anything runs

Disk has 3.2 GiB free and the test harness refuses below 2 GiB. No task can build or run a hidden Electron test until about 10 GiB is free. See F1; the worktree part of it has to happen first.

## Rules for every task

1. Work in a new worktree `~/GIT/NoteMind-worktrees/finish-<id>` on branch `finish/<id>`, forked from `perf/pipeline-top-three`. Commit there. Never push, never touch `main`.
2. Never open, quit or modify `/Applications/NoteMind.app`, `~/Documents/NoteMind` or the real profile. Tests use a throwaway profile (`NOTEMIND_HOME`, `NOTEMIND_DATA` set to a temp directory).
3. One build or hidden Electron run at a time across all tasks, at `nice -n 15`. Hidden runs go through `node_modules/.bin/electron test/hidden-runner.cjs <name>`.
4. No physical pen, camera, clipboard or visible windows in tests.
5. Focused tests only while building: `node --test --test-concurrency=1 test/<files>`. The full suite (`npm test`, about 140 s) runs once, in D1.
6. New files: one statement per line, at most 120 columns. Edits inside the existing dense files: keep that file's style and change the fewest lines.
7. Follow `AGENTS.md`. No new instructional text in the drawing pane.
8. Do not weaken a guard, fixture, oracle or limit to make a test pass. If a task cannot meet its "Done when", stop and report what happened with the command and its output.
9. Report in at most 15 lines: branch, commits, each "Done when" line with its command and result, anything not done.

## Review protocol (Opus, every task)

The reviewer gets the task text and the branch name, not the builder's report.

1. Read `git diff perf/pipeline-top-three...finish/<id>`.
2. Run every "Done when" command itself.
3. Check the rules above and the task's "Review" line.
4. Answer `PASS`, or numbered findings each with `file:line`, what is wrong, and how to reproduce it.

Findings go back to the same builder. After two failed rounds, stop and escalate to Sean.

---

## A. The known limits cause no other trouble

The two "failed gates" are a 1 GiB memory target that a test harness enforces by killing the app. Nothing shows yet what the real app does past that point. A1 finds out.

### A1 — Measure both workloads with the kill switch raised

- **Build:** Add a test-only way to raise the aggregate guard to 4 GiB (environment variable read by the harness; default unchanged). Run, hidden, one at a time:
  1. 100-photo note with OCR: start from `test/real-raster-performance.cjs` and the receipts in `test-results/performance-0.37/` (search them for `full100`).
  2. Cold open of the 16 MiB single-line note: `grep -rl source-control-cold test` finds the harness; the receipt is `test-results/performance-0.37/source-control-cold-91463.json`.
  3. The same two at everyday size: 10 photos; a 1 MiB note.
- **Record** for each run, in `docs/audit/LIMITS-IN-PRACTICE.md` (one table, under 30 lines): exit code, finished or not, peak aggregate memory, memory 60 s after it finishes, wall time, and for the OCR run the memory growth per page.
- **Done when:** four rows exist, each with a real exit code, and each workload has a one-line verdict: "finishes and releases memory" or "grows N MiB per page and does not release" or "crashes/hangs at X".
- **Review:** rerun one row and get within 10 %. `git diff` shows the default guard value unchanged.

### A2 — Only if A1 finds a crash, hang or memory that never comes back

Stop and report to Sean with the A1 table. The fix is a new task written from that evidence.

---

## B. Finish the source editor

Goal: a note of any admitted size (up to the existing 50 MiB limit) opens, edits and saves without the textarea's memory blow-up. Design and module map: `docs/audit/LARGE-SOURCE-EDITOR-ARCHITECTURE.md`. Starting code: branch `feature/source-editor-adapter` (`src/source-editor.js`, 13 tests in `test/source-editor-contract.test.cjs`).

Decision taken here, change it if wrong: **the textarea stays the editor for ordinary notes. The new editor is used only for notes of 2 MiB or more, chosen when the note opens and not switched mid-session.** Everyday editing keeps the proven path.

"Editor group" below means: `test/notes-*.test.cjs test/editor-*.test.cjs test/find-*.test.cjs test/footer*.test.cjs test/source-editor-*.test.cjs`.

### B1a — Create the service and route the core through it

- **Build:** Merge `feature/source-editor-adapter`. Load `src/source-editor.js` from `src/index.html`. Create one service over `<textarea id="source">` with `getIdentity:()=>({tab:activeTab,document:doc,revision:activeTab?.editVersion})`. Replace every direct textarea read/write in `src/renderer.js` (20), `src/notes-core.js` (10), `src/notes-tabs.js` and `src/notes-history.js` with service calls. No behaviour change.
- **Done when:** editor group passes; a new `test/source-editor-no-direct-access.test.cjs` fails if those four files contain `.setRangeText(`, `.setSelectionRange(`, `.selectionStart`, `.selectionEnd` or `.selectionDirection` on anything but the service.
- **Review:** undo/redo, save and tab-switch paths still pass the same event object and target the history code expects; no synthetic `InputEvent`.

### B1b — Route the editing commands through it (after B1a)

- **Build:** Same replacement in `src/notes-writing.js` (19), `src/notes-structure.js` (23), `src/notes-format.js` (5), `src/notes-styles.js` (4), `src/notes-tables.js` (6). All four `setRangeText` modes (`select`, `start`, `end`, `preserve`) go through `service.replace`.
- **Done when:** editor group passes; the no-direct-access test covers these five files.
- **Review:** selection after each command is identical to before the change (existing tests assert it; add a case where one is missing).

### B1c — Route clipboard, find, footer and focus through it (after B1a, alongside B1b)

- **Build:** Same replacement in `src/notes-clipboard.js` (5), `src/notes-find.js` (8), `src/notes-footer.js` (1), `src/tablet/renderer/focusReturn.ts`, and the Main-process `editNative` routing, which must ask the service what the editing node is instead of assuming `document.activeElement` is the textarea.
- **Done when:** editor group passes; the no-direct-access test covers these files; `grep -rnE "getElementById\('source'\)" src` matches only where the service is created.
- **Review:** cut/copy/paste/select-all from the context menu still act on the editor.

### B2 — Add the viewport editor behind the service, switched off (after B1a–c)

- **Build:** Add CodeMirror, pinned exactly: `@codemirror/view` 6.43.15 and `@codemirror/state` 6.7.6 plus the four packages they need (the six in the prototype). Apply the prototype's one-line change to the view constructor (`gap.draw(this,false)` → `gap.draw(this,this.heightOracle.lineWrapping)`) as a recorded patch, with the licence added to `THIRD-PARTY-NOTICES.txt`. Prototype source: `~/GIT/NoteMind-worktrees/frozen-final-ui-recheck/test-results/active-source-cm6-calibrated/`, archived in `test-results/performance-0.37/source-editor-cm6-evidence.tgz`.
  Write `cmBackend(host)` in a new `src/source-editor-cm.js` with exactly the interface of `nativeBackend` in `src/source-editor.js`. Line separator fixed to `\n`. Wrapping, font, line height and width identical to the textarea's CSS. **No CodeMirror history extension.** Bundle it in `scripts/build.cjs`. Select it only when a test passes `backend:'cm'`.
- **Done when:** the contract tests run against both backends in a hidden Electron run and pass; a hidden run opens the 16 MiB single-line fixture in the new backend under 1 GiB aggregate, reads back the exact SHA `f50aa3d7…cf1f`, selects backwards, scrolls to the end and disposes; the report states the package size increase.
- **Review:** the app with default settings never constructs the new backend; text with CRLF, a trailing newline, surrogate pairs and combining marks reads back byte-identical.

### B3 — Typing, composition and undo with the new editor (after B2)

- **Build:** Feed the new backend's edits into `src/notes-history.js` so NoteMind's own history stays the only undo/redo. Typed input keeps its real event; a programmatic edit or an import is one history step; an active composition is one step and is never destroyed by a tab switch, mode switch or close without an explicit commit.
- **Done when:** a hidden test performs the same script on both backends (type, select, replace, paste, insert an image, undo to the start, redo to the end) and the text and asset list match at every step. Composition is tested with synthetic events and the report says so.
- **Review:** undo after an image or PDF insert removes the asset too; memory does not grow by a full copy of a 16 MiB note per keystroke (measure 20 keystrokes).

### B4 — Find, scrolling and tab restore with the new editor (after B2, alongside B3)

- **Build:** `src/notes-find.js` reveals a match with `service.scrollToPosition` (position-based, so a far match on one wrapped line works). `src/notes-tabs.js` stores scroll as a source position (`{v:1,pos}`) and still reads the old `{v:0,line}` form. Footer zoom applies to whichever editor is mounted.
- **Done when:** hidden tests on both backends: find the last match in the 16 MiB one-line fixture and it is visible; replace-all gives identical text on both; switch tabs and back restores the same top position; an old `{v:0}` anchor still restores.
- **Review:** word count and find offsets come from the full text, never from the visible part.

### B5 — Parity, then switch it on for large notes (after B3 and B4)

- **Build:** Run the whole editor group against both backends and fix every difference. Then enable the rule: 2 MiB or more at open → new editor; otherwise textarea.
- **Done when:** editor group passes on both backends; hidden app run opens the 16 MiB note under 1 GiB aggregate, types, saves, reopens byte-identical; a 50 MiB note opens and saves; a 51 MiB note is refused with the existing message; a 100 KiB note still uses the textarea.
- **Review:** no code path reads only the visible fragment for save, count, export or history.

### B6 — The app must quit

Found while installing 0.38.0 and 0.39.0: after its window closes, the 0.37.0+ main process stays alive and ignores Quit (two Apple-event quits, no exit after two minutes; main thread idle in the run loop). Likely the new shutdown barriers never let `app.quit()` finish.

- **Build:** Reproduce with a hidden run (open the default workspace, close the window, request quit) and fix the cause; do not add a forced exit timer as the fix.
- **Done when:** a hidden test shows the process exits within 5 s of Quit with and without an open window, with a drawing sheet dirty, and the recovery files are written first.
- **Review:** every shutdown barrier added in 0.37.0 still joins its accepted writes.

### B7 — Highlighter on pictures and PDF pages; kinds for camera ink

The 0.39.0 highlighter is an opaque pale band placed under the ink, with no stroke-format change. It is disabled on a sheet with a background picture and on PDF pages, it hides the paper's dots under it, and camera ink (`CameraInk.tsx`) is pen-only. Tool presets do not store the pen kind.

- **Build:** Give strokes an optional kind that survives every store, codec, signature and validator (format version bump with migration), render highlighter strokes with multiply blending in the canvas, SVG and raster paths, enable it over backdrops and PDF pages, share the kind capture with camera ink, and store the kind in presets.
- **Done when:** round-trip tests for every codec; a hidden run highlights over a picture and a PDF page with the text still readable; 0.39.0 sheets open unchanged.
- **Review:** no existing sheet changes its signature on load.

---

## C. Finish native OCR

Background: branch `test/ocr-native-runtime` holds a test-only experiment that runs the OCR models with `onnxruntime-node` 1.30.0 in a separate process (`docs/OCR-NATIVE-FEASIBILITY.md` on that branch). Its best run did 28 of 100 pages before passing 1 GiB, so it has not yet beaten the built-in engine. It costs 89 MB in the app and needs macOS 14 or later.

### C1 — Does it pass on the current code? (can run alongside B1)

- **Build:** Bring the diagnostics from `test/ocr-native-runtime` onto the current head, which has the newer image transport they were never run with. Run the 100-photo workload once with the separate-process native engine, original guards.
- **Done when:** `docs/OCR-NATIVE-FEASIBILITY.md` has a dated result: pages completed out of 100, peak aggregate memory, time per page against the built-in engine, and whether the recognised text matches the built-in engine on the quality corpus.
- **Review:** the run used the unmodified workload and guards; every started process exited.
- **If it does not complete 100 pages under 1 GiB: stop and report to Sean.** Whether to keep native OCR at all is his decision.

### C2 — Ship it as an engine with fallback (only if C1 passes)

- **Build:** Add the macOS arm64 slice of `onnxruntime-node` 1.30.0 to the package; sign its library and binding in `scripts/build.cjs`; add the licence to `THIRD-PARTY-NOTICES.txt`. Run it only in a forked child (`ELECTRON_RUN_AS_NODE=1`), never loaded in the main or renderer process. Cancel by ending the child. Use the built-in engine when the native one fails to load, the child crashes twice, macOS is older than 14, or the platform is not macOS arm64.
- **Done when:** unit tests cover load failure, child crash, cancel mid-page and each fallback; `codesign --verify --deep --strict` passes on the built app; a hidden run reads the eight-image fixture with text identical to the built-in engine.
- **Review:** Windows and Linux builds are unchanged in size and behaviour.

---

## D. Verify (after B and C are merged)

### D0 — Bring the manual UI harnesses up to the 0.39.0 toolbar

0.39.0 moved Save and Clear into the drawing options menu, tablet orientation into that menu's submenu, the Wacom screen switch into the capture source menu, and the sheet's actions onto the pen bar. Five hidden-runner scripts still drive the old controls and fail: `test/drawing-tools.cjs`, `test/pad-app.cjs`, `test/review.cjs`, `test/welcome-guide.cjs`, `test/workspace-ux.cjs`.

- **Build:** Update their selectors and steps (`[data-tablet=pane-save]`, `[data-tablet=clear]`, `[data-tablet=orientation-menu]`, `#pen-control button[data-drawing-location]`, `[data-pane-slot="header"] [data-camera-head="tablet"]`) to the new places; `test/tablet-two-bars.cjs` shows them. Change no assertion about behaviour.
- **Done when:** each of the five exits 0 under `node_modules/.bin/electron test/hidden-runner.cjs <name>`.
- **Review:** `test/pad-app.cjs` still proves the Wacom-screen round trip and that the pad window's bars fit.

### D1 — Full suite and signed build

- **Build:** `npm test`; `npm run build`; `codesign --verify --deep --strict dist/NoteMind/NoteMind.app`; the two-launch save-and-recover check described in `docs/audit/PACKAGED-STARTUP-RECOVERY.md`.
- **Done when:** 0 failed, 0 skipped; signature valid; second launch recovers the exact text saved by the first.

### D2 — Hands-on pass in a scratch copy

- **Build:** Copy the built app, give the copy bundle id `com.seancheren.notemind.scratch`, re-sign it and confirm `codesign --verify` passes before launching, and give it its own profile directory. Drive it with background computer use, in dark and light, with real-looking and very long content. Cover: notepad list and search; every editor toolbar menu; find and replace; tabs; workspaces; drawing pane (pen, eraser, selection, presets, zoom and angle, page overview, insert background); camera pane; PDF import; PDF reference pane with markup; Word import and export; print; preferences; help.
- **Done when:** `docs/audit/HANDS-ON-0.40.md` lists each screen as "ok" or a numbered defect with a screenshot path and steps.
- **Review (Opus):** look at every screenshot; add defects the builder missed; rank them release-blocking or not.

### D3 — One task per release-blocking defect from D2

- **Build:** a failing test first where the defect is testable, then the fix, then the same hands-on step again.
- **Done when:** the D2 step that showed it now shows it fixed, with a new screenshot.

---

## E. Ship (after D)

### E1 — Release 0.40.0

Set the version to 0.40.0, merge into `main`, run `npm run preflight`, tag `v0.40.0`, push `main` and the tag, build and sign, install to `/Applications/NoteMind.app` after Sean's running copy is closed by him. Update `docs/CLAUDE-HANDOFF.md` to a ten-line statement of what shipped and the known limits from A1.

---

## F. Clean up (after E, except the first step of F1)

### F1 — Worktrees

None of the 119 worktrees has an uncommitted change to a tracked file. 67 show only an untracked `node_modules` link and one (`word-native-profile`) a stray `src/vendor/vendor`. Every branch stays.

- **Now, before A:** remove all worktrees except `frozen-final-ui-recheck` and `ocr-native-runtime`, which hold untracked files B2 and C1 read. Frees about 7 GB.
- **After E:** remove those two.
- **Done when:** `git worktree list` shows only the main checkout; `df -h ~` shows the space back.

### F2 — Branches

118 of 122 branches exist only on this Mac. Push all of them to `origin` under `archive/`, then delete the local ones that are not `main`. Nothing is deleted before it is on the remote.

### F3 — Old app copies and test output

Move to the Trash: the eight old `NoteMind*.app` copies that share the bundle id (`~/Applications/NoteMind Backups`, `~/Documents/NoteMind/Backups`, `~/Documents/NoteMind/Installation Backups`, the repo's `dist`), once 0.40.0 is installed and working. In `test-results/`, keep the `.json` and `.log` receipts and delete the rest.
