# Limits in practice

Hidden runs on 2026-11-18 with the 4 GiB aggregate test guard. Peak and 60-second measurements sum Electron process working sets while the window is still open. Wall time ends when the workload finishes. The editor runs exercise the original cold native textarea and exclude the footer counter.

| Run | Exit code | Finished | Peak | Memory 60 s after finishing | Wall time | Memory growth per OCR page |
| --- | ---: | :---: | ---: | ---: | ---: | ---: |
| Original 100 photos and OCR | 0 | Yes | 1,116.0 MiB | 724.9 MiB | 450.35 s | +0.28 MiB |
| Cold 16 MiB single-line editor | 0 | Yes | 2,136.5 MiB | 1,491.0 MiB | 2.25 s | — |
| First 10 original photos and OCR | 0 | Yes | 1,131.6 MiB | 692.8 MiB | 62.87 s | — |
| Cold 1 MiB single-line editor | 0 | Yes | 458.4 MiB | 448.1 MiB | 1.37 s | — |

The 100-photo rate uses the change in sampled aggregate memory from the first to the last of 100 matched OCR replies, divided by 99.

- 100 photos finishes and gives the memory back in part. Working set drops 391.1 MiB from peak.
- 16 MiB finishes and gives the memory back in part. Working set drops 645.5 MiB from peak and still holds 1,491.0 MiB at 60 seconds.
- 10 photos finishes and gives the memory back in part. Working set drops 438.8 MiB from peak.
- 1 MiB finishes and gives the memory back in part. Working set drops 10.3 MiB from peak.
