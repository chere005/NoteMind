# Narrow cleanup and ownership review

This review covers print staging/consumers, archive retirement and startup cleanup, and model-stop retry. It is not the final whole-App bug, UX or performance audit. Root owns integration and release qualification.

| Issue class | Leaf | Concrete authority |
|---|---|---|
| Final print drain missed work registered during failed-cleanup retry | `45d37e9` | Gated staging and consumer test fails on `49a36a1`; permanent I/O backpressure preserved |
| Closed document services admitted new work and did not join final export writes | `3fd757b` | Three source-backed regressions fail on `49a36a1`; Root separately corrected late public OCR payload cleanup |
| Archive retirement discarded failed owner authority and cached a rejected cleanup forever | `2db4b9e` | Actual worker exit followed by owned unlink EIO, explicit retry, foreign replacement preservation, and replacement-epoch raw lease checks |
| Final directory-removal errors lost authentication after marker retirement | `c97170d` | Final-rmdir and ambiguous unlink faults, foreign insertion, replacement directory and replacement receipt checks |
| Repeated archive disposal could not retry a rejected termination request | `f95e394` | Same pending actual-exit join; retry only failed request, never pending/successful acknowledgements |
| Repeated model/document disposal could not retry rejected or throwing stop requests | `9485e89` | Real TextReader plus DocIO dispose function; three failing-baseline checks, borrowed input preserved |
| Worker construction failure lost its never-started spool cleanup | `ff3c18d` | Real owned-directory EIO, disposal rejection/retry and bounded replacement admission without replay |
| Queued or failed-post archive input was decharged before private Main backing retired | `e7c9025` | Owned/borrowed queued disposal, queue failure, unposted post failure and already-moved receiver checks |

Focused check counts in commit messages overlap and must not be summed as bugs or independent test passes. The newest input/retirement/inspection group passed 38 checks; each preceding leaf records its own failing baseline and affected verification.

All fake process/worker termination acknowledgements remain distinct from actual exit events. Actual filesystem ownership uses authenticated original directory/receipt identities; unknown files and replacement inodes are preserved. Explicit private input transfer lists can retire before quota release; caller-borrowed and already-posted receiver input remains untouched.

The independent whole-App sweep was asked to examine adjacent spool initialization faults before an owner is returned. That path was not reproduced or changed in this retirement review. Native runtime research and its separate test-only process prototype live in `docs/OCR-NATIVE-FEASIBILITY.md` on the research branch; no Native default or dependency was adopted by these leaves.
