# Transport and shutdown review

November 18, 2026. Independent review of Root `7517e2e`, including Main close observation (`f5ea732`), final document cleanup (`0a7c492`) and public OCR capacity deadlines (`7517e2e`). The separate binary-output branch was read through `f4e2661`. Subsequent authorized closures extend through local `fc3f27b`. This is not the final whole-app audit wave.

## Reproduced findings

| Finding | Reproduction and closure |
|---|---|
| Repeated PDF disposal resolved before the first cleanup; its one-shot quit listener did not provide a durable quit barrier. | An actual service with `PDFReferenceJobs` and a captured fake worker showed the second caller finishing while the worker still lived. `3c3be21` caches the joined disposal promise and keeps an observed, retryable quit barrier across independent quit attempts. Both callers wait for actual exit and owned cleanup. |
| PDF worker retirement swallowed real cleanup errors and dropped exact lease ownership before successful cleanup. | An injected EIO at the real cleanup boundary incorrectly resolved disposal. `2c9a881` retains the exact exited worker and lease IDs, propagates real I/O failures, observes idle retirement errors, drains queued failures and retries before allowing a replacement. Existing changed-inode and foreign-child preservation remains intact. |
| A PDF open waiting for an archive ink save could create a renderer after service disposal or owner destruction. | The production service resumed LRU eviction into an orphaned owner map. `eca740c` revalidates the captured service, sender and owner map after asynchronous boundaries and before creating a client. Both disposal and owner-loss regressions preserve the original two clients and create no late renderer. |
| A malformed binary chunk identity could leave release waiting forever on an unacknowledged sender. | Independent source review identified the valid-Main-backing/invalid-token path. The architecture owner closed it in `84513c0`: Main backing retires, the helper returns typed uncertainty, and captured-PID quarantine retains the sender owner. |
| A lost begin reply could orphan an already allocated private input; malformed Main clone shapes could outlive renderer-only cleanup. | The architecture owner closed these findings in `5dd49d3` and `f4e2661`: Main chooses an idempotent admission identity, exact transient retries drain autonomously, complete private Main backing retires for partial/oversized/direct clones, and an unexpected shared Main backing stays independently quarantined. Borrowed generic callbacks remain unchanged. |
| PDF shutdown and owner destruction could close a source needed by pending external ink saves or first-source backup. | `2cee5b5` joins captured saves and exports before private clients and the file worker close. Destroyed owners lose admission immediately; their retired owner map retains the source consumer until final receipts, with failed cleanup available for retry. |
| Drawing persistence disposal could lose a live worker on a second call or failed termination request. | `1c49d0c` preserves one disposal promise and captured worker-exit records, retains upload ownership, retries only a failed stop request on explicit repeated disposal, and joins the remaining serial Main commit/maintenance tail. A terminate acknowledgement never substitutes for actual exit. |
| Main dropped core cleanup promises and could stop shared archive storage while producers still needed it. | `fc3f27b` keeps a persistent observed quit barrier: producers, then drawing/camera write receipts, then persistence, then archive. Failed stages remain retryable. Separate producer/persistence/archive stop retries do not bypass dependency order. |

The reviewer authored the PDF, drawing and core closures; their focused runs are author validation. Root independently reviews/integrates them. The independent read of the original Root leaves found no additional defect in those particular changes. The binary branch's subsequent fixes received an independent read and focused run through `f4e2661`; its native pixel/memory gates remain separate.

`a7b37d9` repairs a pre-existing test fixture boundary and missing browser global, preserving all 31 close-quiescence cases and assertions. New tests inserted before a named extraction boundary had made 29 cases fail in VM setup before testing the product. This is a test-harness repair, not a product bug count.

## Focused verification

All runs use pinned Electron 44.11.3 in Node mode, Node 24.22.2, with dependencies from the stable-candidate worktree. No native app window, physical pen/camera, build, package, installed app or full test suite was used.

- PDF service, shutdown, retirement, actual file-worker, lease, recovery and IPC matrix: 51 passing cases at `2c9a881`; the final source-consumer extension passes 43 affected service/retirement/recovery/IPC cases at `2cee5b5`.
- Root shutdown, public OCR admission/IPC and real archive capacity cases pass; the separate document-IO lifecycle file passes all 15 cases, including a canceled `before-quit` retaining live services.
- Binary/client/probe/default converter/pixel adapter/raster-worker matrix at `f4e2661`: all 56 cases pass. Lost begin/read/ACK/release recovery is autonomous for tested transient faults. Permanent uncertainty retains its actual owner; the shared-Main case uses a fresh exited Node child to isolate the intentional process-lifetime quarantine.
- Drawing/camera persistence, actual workers, retirement, durability and cooperative read cancellation: 42 cases pass; four disposal faults were rerun after strengthening upload retention assertions.
- Core/Main/document/drawing/close-quiescence matrix: 53 cases pass, followed by five core cases after adding actual core+document+PDF callback integration on one app event emitter. The counts overlap and are not a unique-test total.

Core integration depends on Root's joined image-picker/document producer and archive-disposal leaves. Archive owner cleanup and failed-stop retry were separately implemented by the native-runtime owner; this reviewer did not alter `archive-codec.cjs` or qualify that integrated runtime.

## Subsequent publication and decoder review

Root's guarded replacement and PDF publication leaves (`a77ac1d`, `9e5478f`) received an independent source read and 38 focused pinned-runtime checks. Writable-file sync failure preserves the old target; parent-directory sync failure retains the committed flag; physical aliases, concurrent revisions and the synchronous final cancellation fence remain checked.

That read reproduced one public-caller gap at `cdefcc4`: after real PDF target rename, an injected directory-fsync EIO left the target containing the exported bytes while `exportDocument` rejected as an ordinary failure. `78e78ac` follows the existing warning observer for committed PDF results, retains the legacy filepath return and uses a format-aware saved-file message. A failed warning observer cannot lose the committed success. Direct exports without an observer still throw the committed receipt, and precommit failures stay strict. All 48 focused publication, document lifecycle, native lock and core-quit checks pass.

The private owned-input decoder at architecture `7527e5f` received an independent read and 60 focused pinned-runtime checks, including its opt-in, custom/default/borrowed behavior, protocol retirement and client lifecycle. An additional independent 4,402-case parity sweep covers every two-character padded one-byte prefix, sampled two-byte padding values and whitespace/Unicode/invalid insertions. Decoded bytes and error names/messages match the legacy decoder in every case; both session/byte/chunk maps drain to zero. No native memory or image-pixel claim follows from this source check; the architecture owner runs those serially under Root's grant.

These focused checks do not establish native structured-clone memory, exact image pixels, full-workload memory, packaged shutdown or whole-app readiness. Those remain separate Root gates with unchanged workload and process-exit requirements.
