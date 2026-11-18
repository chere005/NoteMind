# Packed Word and source-counter processing

Leaf `c6b4da7` is based on Root `2ab0c018`. The existing1.04MB CPU profile attributes substantial self time to view-cache lookups, delimiter postprocessing/balancing and text joining. The compact parser now processes those same packed rows directly during these passes. It retains bounded columns, source contents, installed Markdown grammar, nested delimiter scope, token ordering and cancellation. A changed extension rule or caller-owned list state takes the compatible rule path. Unpublished joining ledgers are explicitly retired on exceptions.

Pinned Electron44.11.3/Node24.22.2 passes34 focused checks: existing Word/footer cases,500 deterministic malformed/nested inputs, a fault guard forbidding view materialization during the stock passes, replaced rules and caller-owned list compatibility, and unpublished backing retirement. No full suite or application release qualification is claimed.

One cold matched browser-bundle pair uses the exact same1,040,000-byte source, SHA `b7e650a2c6474f86197a22c0a3384402f7eb386588104020b577339e5ef97256`, and returns all120,000 words on both sides. Both minified bundles use the same64 shared source/dependency files; only `word-inline.cjs` differs. Each fresh pinned process executes the same VM wrapper without warmup. Heap limits are identical, aggregate sampling includes the actual Worker thread plus16MiB reserve, and the1GiB guard/2GiB disk floor remain unchanged.

| Matched compact-parser stage | Before | After |
|---|---:|---:|
| Count operation | 1,678.010ms | 1,165.461ms |
| VM load plus count | 1,695.101ms | 1,181.552ms |
| Sampled RSS plus16MiB reserve | 195,428,352B | 135,069,696B |
| Exact result | 120,000 words | 120,000 words |

Count time is30.55% lower in this pair. Both measurement wrappers exit0; both actual Worker exits are joined; controller PIDs93641/93660 and source-preparation93624/esbuild93632 are kernel ESRCH. All64 shared identities and the candidate Word source remain unchanged. Local receipts are under `test-results/word-inline-pair-c6b4da7-checked/`; the exact executed preparer is preserved there because its later timeout hardening was not part of this measurement.

This small isolated pair does not establish16MiB latency, whole-App memory, production typing speed, release readiness or the final pipeline top-three ranks. The original exact16MiB matched run and native counter/CSP checks require separate serial grants on the integrated bundle. No Native OCR backend or model change is included.
