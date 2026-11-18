# Codex results

## Task 1 — Quit
- Added a hidden test for quitting with the workspace open, after closing it and with a stroke still in progress. All three check recovery before process exit and enforce a five-second deadline.
- `node_modules/.bin/electron test/hidden-runner.cjs quit-exits` exited 0 in all three cases on the unchanged shutdown code.
- `NOTEMIND_QUIT_TEST_PAD=1 node_modules/.bin/electron test/hidden-runner.cjs quit-exits` exited 0 in all three cases with a simulated extended pen display.
- The installed 0.39.0 copy stayed alive after two normal Quit requests. The isolated test did not reproduce the hang, so its cause and fix remain open.
- `npm test` was not required because this task changed only the test and this report.

## Task 2 — Moved controls
- Updated the five hidden scripts' steps and replaced checks for direct or separate controls with checks for menu actions, sheet actions in the pen bar, an empty header slot, always-present swatches, and width and Wacom choices in their menus.
- `node_modules/.bin/electron test/hidden-runner.cjs drawing-tools` exited 1 twice. The new orientation path passed, then the script expected the legacy `sheets.json` file.
- `node_modules/.bin/electron test/hidden-runner.cjs pad-app` exited 1 twice. On the second run the sidebar menus and width choice passed, then the drawing flush timed out.
- `node_modules/.bin/electron test/hidden-runner.cjs review` exited 1 twice. The moved controls passed, then the script expected the legacy `sheets.json` file.
- `node_modules/.bin/electron test/hidden-runner.cjs welcome-guide` exited 1 twice. Both the edit button and the example image were missing after reopening the guide.
- `node_modules/.bin/electron test/hidden-runner.cjs workspace-ux` exited 0 twice, including the orientation and Wacom menu checks.
- The runs redirected Documents to the test profile. Four scripts remain unqualified. Fixtures, storage reads, and unrelated checks are unchanged.

## Task 3 — Limits in practice
- Added a test-only 4 GiB switch and one-minute memory observations. The default aggregate guard remains 1 GiB.
- `NOTEMIND_LIMITS_4_GIB=1 node_modules/.bin/electron test/hidden-runner.cjs real-raster-index-completion` exited 0 with 100 completed pages.
- `NOTEMIND_LIMITS_4_GIB=1 node_modules/.bin/electron test/hidden-runner.cjs source-control-native` exited 0 with the exact 16 MiB source.
- The same OCR command with `NOTEMIND_LIMITS_TEN_PHOTOS=1` exited 0 on retry with 10 completed pages. The first run reached 10 replies before a test still expected a count of 100.
- The same editor command with `NOTEMIND_LIMITS_ONE_MIB=1` exited 0 with the 1 MiB source.
- All four rows and verdicts are in `docs/audit/LIMITS-IN-PRACTICE.md`.

## Task 4 — Native OCR
- Imported the diagnostic tests and prepared them against the current app source, with the same native model ownership and original guard.
- `node_modules/.bin/electron test/hidden-runner.cjs ocr-native-process-mixed-native` ran once and exited 1 at 1,046.1 MiB, with 0/100 native OCR replies and the child exit confirmed.
- The isolated four-input quality pair completed. Text and geometry matched on all four inputs. Confidence checks accounted for the native pair's exit 1.
- The six focused Node test files passed all 33 cases.
- The dated result with timings and corpus details is in `docs/OCR-NATIVE-FEASIBILITY.md`.
