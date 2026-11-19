# Native OCR feasibility

## 2026-11-18

The current 100-photo app run used the native child with the original 1 GiB aggregate guard. It displayed all 100 photos and delivered the first 1,800 × 2,400 RGBA input to the child. The guard stopped the run before the first OCR reply. Exit code 1, 0/100 pages, peak 1,046.1 MiB. The child and all observed processes exited.

The built-in engine averaged 3.90 seconds per completed OCR request on the 100-photo measurement with the raised test-only guard. The native full-workload time per page is unavailable because the run completed zero pages.

| Same quality input in isolated processes | Native seconds per page | Built-in seconds per page |
| --- | ---: | ---: |
| Cold original 1,800 × 2,400 photo | 4.87 | 4.37 |
| English PNG | 0.42 | 0.52 |
| Japanese PNG | 0.36 | 0.42 |
| Handwriting PNG | 0.42 | 0.55 |

Recognized text, line and word text, and geometry matched on all four quality inputs. The largest confidence difference was 0.00000149. The native quality driver exited 1 because it also checks exact confidence values. Both quality processes completed their four cases and their workers exited.
