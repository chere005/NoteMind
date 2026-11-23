<!-- AgentSuite:reference:begin -->
Read and follow the shared baseline at `~/GIT/AgentSuite/AGENTS.md` before working here.
If the checkout is elsewhere, locate `AgentSuite/AGENTS.md` beside this repository's main checkout.
The shared `dtp` and `tdtp` definitions, authorization, and installed result apply in every project and worktree; local lane details do not redefine them.
@~/GIT/AgentSuite/AGENTS.md
<!-- AgentSuite:reference:end -->

# Working in NoteMind

- macOS targets Apple Silicon only; Windows and Linux architecture support is unchanged.
- Use NoteMind namespaces for app identifiers, preferences, native helpers and test fixtures.
- Treat committed strokes and point arrays as immutable; drawing caches use their identity.
- Fix small UX defects found during an audit before finishing it.
- NoteMind is part of MindSuite: after publishing a release, record its tag with `node ../MindSuite/tools/mindsuite-release.mjs record NoteMind vX.Y.0 --app-repo .` (see README, Updates).
- Releases: `npm run release` is the dtp lane (README, "Updates, signing and releases"). Sign with the full Developer ID name and the hardened runtime, notarize with the `DisplayMind` profile, never ship an ad hoc build, no Windows Authenticode signing (decided). Windows updating is unrun; say so.
- Do not add persistent instructional or diagnostic prose to the drawing pane; use existing controls and requested tooltips.
- **Standing rule: the pen buttons must never break.** `docs/PEN-BUTTONS.md` is the behaviour Sean set and confirmed: lower held + tip = delete, lower double-tap = Undo; upper held + tip = selection box, upper double-tap = Redo; lower tapped then upper held + tip drag = zoom (up in, down out); upper tapped then lower held + tip drag = scroll. A held button alone does nothing, and a held button is a mode until let go. Change it only on Sean's explicit word, with that page and its tests in the same commit. Never weaken, skip or remove `test/pen-buttons-contract.test.cjs`, `test/pen-buttons-app.test.cjs` or `test/pen-buttons-native.test.cjs`; `test/pen-contract-doc.test.cjs` checks they exist. Run them after any change to pen input, the helper, the sheet or event routing, and ship nothing that fails them. Read `pen.log` and the `[pen]` lines in `startup.log` first when a button seems wrong.
