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
- Do not add persistent instructional or diagnostic prose to the drawing pane; use existing controls and requested tooltips.
